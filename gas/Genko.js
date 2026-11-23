// 自動生成（tools/build-gas.mjs）。正本は src/genko.js（作文の形をそろえる normWork をサーバーでも使う）
// 説明文を書く（設計書 §28）の共通部品：原稿用紙の組み方・見なおしの判定・テンプレート・お手本。
// 画面は app.js の sakubun*()、検査は tests/genko.test.mjs。DOM に触れない（ブラウザ・Node 共通）
//
// 原稿用紙の決まり（一般的な書き方。docs/features/setsumei-writing.md に出典）:
//   400字づめ（1行20マス×20行）。右の行から書き、左へ進む。1マスに1字。改行（段落）は次の行から。
//   「、」「。」「」」などは行の頭に書かない → 前の行の最後のマスに、字といっしょに入れる（hang）
//   「「」などは行の最後のマスに書かない → 次の行へ送る
//   小さい「ゃゅょっ」も1マス（画面で右上に寄せる）
//   1行目＝題名（上を3マスあける）、2行目＝名前（下につめ、いちばん下は1マスあける）、本文は3行目から
(function (root) {
  'use strict';
  var Z = '　', ROWS = 20, COLS = 20;
  var HANG = '、。，．」』）〕】！？';
  var OPEN = '「『（〔【';
  var SMALL = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ';

  // 半角の英数字・記号・空白を全角に（マス目をそろえる。1字下げを半角空白で入れても判定できるように）
  function toZen(s) {
    return String(s).replace(/[!-~]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0xFEE0); }).replace(/ /g, Z).replace(/\r/g, '');
  }

  // 文字ごとに（行 col, マス row）を決める。src の改行1つ＝段落の区切り。
  // 返す: { cells: [{ col, row, c, i, hang?, small? }], pos: [i → { col, row, after? }]（i は src の文字番号、末尾 = src.length）, cols }
  // pos はカーソルの位置（その字の前）。after は「そのマスの後ろ」（行の最後のマスの下）
  function layout(src) {
    src = String(src || '');
    var cells = [], pos = new Array(src.length + 1), col = 0, row = 0, i = 0;
    var lines = src.split('\n');
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      row = 0;
      for (var k = 0; k < line.length; k++, i++) {
        var c = line[k];
        if (row >= ROWS) {
          if (HANG.indexOf(c) >= 0 && k > 0) { cells.push({ col: col, row: ROWS - 1, c: c, i: i, hang: true }); pos[i] = { col: col, row: ROWS - 1, after: true }; continue; }
          col++; row = 0;
        }
        if (OPEN.indexOf(c) >= 0 && row === ROWS - 1) { col++; row = 0; }
        var cell = { col: col, row: row, c: c, i: i };
        if (SMALL.indexOf(c) >= 0) cell.small = true;
        cells.push(cell); pos[i] = { col: col, row: row }; row++;
      }
      pos[i] = row >= ROWS ? { col: col, row: ROWS - 1, after: true } : { col: col, row: row };
      i++; col++;
    }
    return { cells: cells, pos: pos, cols: Math.max(col, 1) };
  }
  function pages(cols) { return Math.max(1, Math.ceil(cols / COLS)); }

  // 名前の行: 下につめて、いちばん下は1マスあける
  function nameLine(name) { name = toZen(name || ''); return Z.repeat(Math.max(0, COLS - 1 - name.length)) + name + Z; }

  // テンプレート（利用者の指定: 穴は【食材】だけ。中は段落の枠＝空の行）
  function template(name) {
    return [Z + Z + Z + 'すがたをかえる【食材】', nameLine(name),
      Z + '【食材】には、いろいろな食べ方のくふうがあります。', '', '', '',
      Z + 'このように、【食材】は、くふうされて、いろいろなすがたになって食べられているのです。'].join('\n');
  }
  function blank(name) { return [Z + Z + Z, nameLine(name), Z].join('\n'); }

  // ---- レポートを書く（設計書 §30。横書き・利用者の指定）。組み方（layout）は縦書きと同じで、画面と印刷で向きだけを変える。
  //   はじめから見出し「１．調べたきっかけや理由／２．調べ方／３．調べて分かったこと／４．まとめ」と〈使った本〉が入っている。
  //   見出しの行・〈使った本〉から後の行は、1マスあけの判定をしない
  var REPORT_HEADS = ['１．調べたきっかけや理由', '２．調べ方', '３．調べて分かったこと', '４．まとめ'];
  var BOOK = '〈使った本〉';
  function isReport(w) { return !!w && (w === 'report' || w.mode === 'report'); }
  function reportTemplate(name) {
    var ls = [Z + Z + Z + '【　　　　　】のくふう', nameLine(name)];
    REPORT_HEADS.forEach(function (h) { ls.push('', h, Z); }); // 見出しの直前は1行あける（利用者の指定）
    ls.push(BOOK, Z);
    return ls.join('\n');
  }
  function isHead(line) { return /^[１-９1-9][．.]/.test(String(line || '')); }
  function isSub(line) { return /^[（(][１-９1-9][）)]/.test(String(line || '')); } // （１）などの小見出し（1マスあけを問わない）

  // ---- 作文例（社会「西宮の酒づくり」・地域教材の事実だけで書く。§30 の段階: 写す→えらぶ→かえる→自由）
  //   見出しごとに 2〜3 つ。組み合わせは自由（３に合わない４も えらべる: 違和感に気づかせるため。利用者の指定）。
  //   【 】＝「かえる」の段階で穴になる所（「えらぶ」では【 】を外して入れる）。（１）で始まる行は小見出し（1マスあけない）
  // 練習（ふでばこの道具）: 自分の道具を見れば すぐ調べられる題材。事実は一般に知られた製品のくふうだけ（出典は docs/features/report-writing.md）
  var REPORT_FUDE = { id: 'fude', topic: 'ふでばこの道具（練習）', title: 'ふでばこの道具のくふう', parts: [
    [{ id: '1a', label: 'えんぴつの形に気づいた', lines: ['毎日使っている【えんぴつ】をよく見ると、六角形になっていました。なぜまるくないのだろうと、ふしぎに思いました。そこで、ふでばこの道具のくふうについて調べることにしました。'] },
     { id: '1b', label: '友だちとくらべた', lines: ['【友だち】とふでばこの中の道具をくらべていたら、形や色がいろいろあることに気づきました。どれにも、何かわけがあるのかなと思いました。そこで、ふでばこの道具のくふうについて調べることにしました。'] },
     { id: '1c', label: '新しいふでばこ', lines: ['【三年生になって】、新しいふでばこを買ってもらいました。中の道具を一つずつ見ていると、小さなあなや切りこみがあることに気づきました。そこで、ふでばこの道具のくふうについて調べることにしました。'] }],
    [{ id: '2a', label: '自分の道具を見た', lines: ['自分のふでばこの道具を、一つずつよく見ました。また、【友だちの道具】ともくらべました。'] },
     { id: '2b', label: '本で調べた', lines: ['自分の道具をよく見てから、文ぼう具の本で、そのわけを調べました。'] },
     { id: '2c', label: '人に聞いた', lines: ['自分の道具をよく見てから、【家の人】や先生に、そのわけを聞きました。'] }],
    [{ id: '3a', label: '書く・消すくふう', lines: ['（１）えんぴつの形',
        'えんぴつは、六角形になっています。六角形だと、つくえの上でころがりにくく、三本の指で持ちやすいそうです。',
        '（２）消しゴムのケース',
        '消しゴムの紙のケースには、【角に切りこみ】があります。本には、ケースのはしで消しゴムがおれにくくなるようにしていると書いてありました。'] },
     { id: '3b', label: '正しく使うくふう', lines: ['（１）じょうぎの目もり',
        'じょうぎの０の目もりは、はしから少しはなれた所にあります。はしがすりへっても、正しく長さをはかれるようにしているそうです。',
        '（２）はさみの持つ所',
        'はさみの持つ所は、【二つのあなの大きさ】がちがいます。小さいあなに親ゆび、大きいあなにほかのゆびを入れると、力を入れやすいそうです。'] },
     { id: '3c', label: 'あんぜんのくふう', lines: ['（１）キャップのあな',
        'ペンのキャップには、小さなあながあいています。先生に聞くと、「まちがえてのみこんでしまっても、いきができるようにするためです。」と教えてくれました。',
        '（２）はさみの先',
        '子ども用のはさみは、【刃の先がまるく】なっています。人にささったり、けがをしたりしにくいようにしているそうです。'] }],
    [{ id: '4a', label: '書きやすさ', lines: ['いつも使っているえんぴつや消しゴムにも、書きやすく、使いやすくするくふうがあることが分かりました。とくに、【えんぴつが六角形なのにわけがあったこと】に、おどろきました。こんど、【ほかの文ぼう具】のくふうも見つけたいと思います。'] },
     { id: '4b', label: '使う人のことを考えて', lines: ['ふでばこの道具は、使う人がまちがえずに使えるように考えてつくられていることが分かりました。とくに、【じょうぎの０の目もりの場所】に、おどろきました。こんど、【家にある道具】も、よく見てみたいと思います。'] },
     { id: '4c', label: 'あんぜん', lines: ['ふでばこの道具には、使う人がけがをしないためのくふうがあることが分かりました。とくに、【キャップの小さなあな】に、おどろきました。こんど、【教室にあるほかの物】のあんぜんのくふうも、さがしてみたいと思います。'] }]] };
  var REPORT_EXAMPLES = { id: 'sake', topic: '西宮の酒づくり（本番）', title: '西宮の酒づくりのくふう', parts: [
    [{ id: '1a', label: '社会の学習で知った', lines: ['社会の学習で、西宮には日本酒をつくる工場が多いことを知りました。なぜ西宮で【酒づくりがさかんなのか】、ふしぎに思いました。そこで、酒づくりのくふうについて調べることにしました。'] },
     { id: '1b', label: '酒ミュージアムで見た', lines: ['【家ぞくと】酒ミュージアムに行き、むかしの酒づくりで使った大きなたるを見ました。今はどのように酒をつくっているのか、気になりました。そこで、酒づくりのくふうについて調べることにしました。'] },
     { id: '1c', label: '近くの酒工場', lines: ['【わたしの家の近く】には、酒工場があります。いつも【大きなタンク】を見ながら、中で何をしているのだろうと思っていました。そこで、酒づくりのくふうについて調べることにしました。'] }],
    [{ id: '2a', label: '本で調べた', lines: ['地いきの学習の本を読んで、西宮の酒づくりについて調べました。また、本にのっている酒工場の方や杜氏の方の話を読みました。'] },
     { id: '2b', label: 'ミュージアムを見学した', lines: ['酒ミュージアムを見学して、むかしの酒づくりの道具を見ました。それから、地いきの学習の本で、今の酒工場のようすを調べました。'] },
     { id: '2c', label: '人に聞いた', lines: ['地いきの学習の本で調べてから、【家の人】に酒づくりについて話を聞きました。'] }],
    [{ id: '3a', label: '水と米のくふう', lines: ['（１）水のくふう',
        '本には、「酒づくりにとって、水はいちばん大切なものです。」と書いてありました。西宮では、宮水という水を、海がん近くのいどからくみあげて使っています。【わき出る量や水のせいしつがかわらないように】、いつも気をつけているそうです。',
        '（２）米のくふう',
        '西宮の酒工場では、山田錦という、酒づくりにてきした米を使っています。この米は、【近くの六甲山の北側あたり】でたくさんつくられて、西宮にはこばれてくるそうです。'] },
     { id: '3b', label: '人と工場のくふう', lines: ['（１）人のぎじゅつ',
        '西宮の酒は、杜氏を中心とした蔵人たちがつくっています。杜氏は、蔵の中で酒づくりのけいけんが一番ある人しかできません。杜氏の方は、「酒づくりで問題が起きたときに、蔵人から相談されたら解決の方法を教えています。」とおっしゃっていました。',
        '（２）工場のくふう',
        '今は、ほとんど機械で酒をつくっています。びんにつめる機械は、【１時間に数千本】の酒をびんづめできるそうです。また、工場で働いている人は、【工場の中のそうじ】に一番時間をかけているそうです。'] },
     { id: '3c', label: 'これからのくふう', lines: ['（１）多くの人にのんでもらうくふう',
        '酒工場の方は、日本酒をあまりのまなかった人にものんでもらえるように、【入れ物の色や形】をくふうしたり、ユニークな商品の名前を考えたりしているそうです。',
        '（２）新しいものをつくるくふう',
        '酒工場では、お酒を原料にした【けしょう品】や、日本酒とほかのざいりょうをまぜた新しいお酒もつくっているそうです。さいきんは、外国への輸出もふえていると書いてありました。'] }],
    [{ id: '4a', label: '水・米・人のひみつ', lines: ['西宮の酒づくりには、よい水、よい米、すぐれたぎじゅつをもつ人という、いくつものひみつがあることが分かりました。とくに、【水の量やせいしつがかわらないように気をつけていること】に、おどろきました。こんど、【宮水のいど】を見に行きたいと思います。'] },
     { id: '4b', label: 'のんでもらうくふう', lines: ['酒をつくる人たちは、おいしい酒をつくるだけでなく、多くの人にのんでもらうためのくふうもしていることが分かりました。とくに、【入れ物の色や形まで考えていること】に、おどろきました。こんど、【店で酒のびん】を見るときは、どんなくふうがあるか、さがしてみたいと思います。'] },
     { id: '4c', label: 'むかしと今', lines: ['むかしは人の手で、今は機械で酒をつくっていますが、どちらも人のぎじゅつや気くばりが大切だと分かりました。とくに、【そうじに一番時間をかけていること】に、おどろきました。こんど、【酒ミュージアム】に行って、むかしの道具を見てみたいと思います。'] }]] };
  // ---- レポートを組み立てる（§30。練習「ふでばこの道具」の作文例で、見出しごとに えらんで組み合わせ、合うかを判定する）
  // sel: [1の番号, 2の番号, 3の番号, 4の番号]（0＝ア 1＝イ 2＝ウ）。返す: 合わない所 [{ parts: [見出しの番号…], msg }]（空なら合う）
  //   ４↔３: まとめは ３の くふうの話でないと合わない（ア↔ア・イ↔イ・ウ↔ウ）
  //   ２↔３: ３アは「本には」→ ２は本で調べた（イ）。３ウは「先生に聞くと」→ ２は人に聞いた（ウ）
  //   １↔３: １アは「えんぴつ」がきっかけ → ３にえんぴつ（ア）。１ウは「あなや切りこみ」→ ３ア（切りこみ）か３ウ（あな）
  var KUMI_3 = ['書く・消すくふう', '正しく使うくふう', 'あんぜんのくふう'];
  function kumiCheck(sel) {
    var a = sel[0], b = sel[1], c = sel[2], d = sel[3], out = [];
    if (d !== c) out.push({ parts: [2, 3], msg: 'まとめは「' + KUMI_3[d] + '」の話なのに、３で書いたのは「' + KUMI_3[c] + '」です' });
    if (c === 0 && b !== 1) out.push({ parts: [1, 2], msg: '３に「本には…書いてありました」とあるのに、２の調べ方に 本が 出てきません' });
    if (c === 2 && b !== 2) out.push({ parts: [1, 2], msg: '３に「先生に聞くと」とあるのに、２の調べ方に 人に聞いたことが 出てきません' });
    if (a === 0 && c !== 0) out.push({ parts: [0, 2], msg: 'えんぴつの形が きっかけなのに、３に えんぴつの話が ありません' });
    if (a === 2 && c === 1) out.push({ parts: [0, 2], msg: 'あなや切りこみに 気づいたのが きっかけなのに、３に その話が ありません' });
    return out;
  }
  function kumiText(sel, set) {
    set = set || REPORT_FUDE;
    var ls = [Z + Z + Z + set.title, nameLine('')];
    REPORT_HEADS.forEach(function (h, i) { ls.push('', h); ls = ls.concat(exLines(set.parts[i][sel[i]], false)); });
    return ls.join('\n');
  }
  // 問題: 半分くらいは合う組み合わせ（rnd は 0〜1 を返す関数。検査で決まった値を渡せる）
  function kumiProblem(rnd) {
    rnd = rnd || Math.random;
    var all = []; for (var i = 0; i < 81; i++) all.push([Math.floor(i / 27), Math.floor(i / 9) % 3, Math.floor(i / 3) % 3, i % 3]);
    var ok = all.filter(function (x) { return !kumiCheck(x).length; }), ng = all.filter(function (x) { return kumiCheck(x).length; });
    var list = rnd() < 0.5 ? ok : ng;
    return list[Math.floor(rnd() * list.length)].slice();
  }
  var REPORT_STAGES = ['copy', 'pick', 'edit', 'free'];
  var REPORT_SETS = [REPORT_FUDE, REPORT_EXAMPLES];
  // 先生の設定は「段階.題材」の1つの文字列（例 pick.fude。@はメールの判定に当たるので使わない）。題材の既定は練習（fude）
  function normStage(v) {
    var m = String(v || '').split('.'), st = REPORT_STAGES.indexOf(m[0]) >= 0 ? m[0] : 'free';
    var tp = REPORT_SETS.some(function (x) { return x.id === m[1]; }) ? m[1] : 'fude';
    return st + '.' + tp;
  }
  function stageOf(v) { return normStage(v).split('.')[0]; }
  function exSet(v) { var tp = normStage(v).split('.')[1]; return REPORT_SETS.filter(function (x) { return x.id === tp; })[0]; }
  function exLines(ex, holes) { // 本文に入れる行（段落は1マスあけ。小見出しはそのまま）
    return ex.lines.map(function (l) { if (!holes) l = l.replace(/[【】]/g, ''); return isSub(l) ? l : Z + l; });
  }
  // 写す段階の見本（各見出しの1つ目。４ａは３ａに合う）
  function reportCopyModel(name, set) {
    set = set || REPORT_FUDE;
    var ls = [Z + Z + Z + set.title, nameLine(name || '')];
    REPORT_HEADS.forEach(function (h, i) { ls.push('', h); ls = ls.concat(exLines(set.parts[i][0], false)); });
    ls.push(BOOK, Z);
    return ls.join('\n');
  }
  // 見出し hi（0〜3）の下の本文を lines に入れかえる。見出しの行と直前の空き行はそのまま（headSig は変わらない）。見出しがなければ null
  function setSection(text, hi, lines) {
    var ls = String(text || '').split('\n'), h = ls.indexOf(REPORT_HEADS[hi]);
    if (h < 0) return null;
    var j = h + 1;
    while (j < ls.length && !isHead(ls[j]) && ls[j] !== BOOK) j++;
    var end = j; if (j < ls.length && isHead(ls[j]) && ls[j - 1] === '' && j - 1 > h) end = j - 1; // 次の見出しの前の空き行は残す
    return ls.slice(0, h + 1).concat(lines, ls.slice(end)).join('\n');
  }
  // 見出しの行は書きかえられない（利用者の指定）。見出しの行の並びと、直前の空き行を1つの文字列にして、変わったかどうかを比べる
  // （もとの作品に空き行がなくても、その作品の形のまま守る）
  function headSig(text) {
    var ls = String(text || '').split('\n'), out = [];
    ls.forEach(function (l, i) { if (REPORT_HEADS.indexOf(l) >= 0 || (isHead(l) && i >= 2)) out.push((i > 0 && ls[i - 1] === '' ? '_' : '') + l); });
    return out.join('|');
  }
  // お手本（自作。テスト・教科書の文はうつさない。事実の出典は docs/features/report-writing.md）
  var REPORT_SAMPLE = [Z + Z + Z + '図書館の本のならべ方のくふう', nameLine('高木　北子'),
    '', REPORT_HEADS[0],
    Z + 'わたしは、本を読むのがすきで、よく市の図書館に行きます。たくさんの本があるのに、読みたい本がすぐに見つかるのはなぜだろうと思いました。そこで、本のならべ方のくふうについて、調べることにしました。',
    '', REPORT_HEADS[1],
    Z + '図書館についての本を読んでから、市の図書館を見学しました。また、司書の方に話をうかがいました。',
    '', REPORT_HEADS[2],
    Z + '本には、せなかに番号のついたラベルがはってあります。本で調べると、本は、なかみによって０から９の番号に分けられていると書いてありました。',
    Z + '司書の方は、「絵本は、小さい子が自分で取り出せるように、ひくいたなにならべています。」とおっしゃっていました。',
    '', REPORT_HEADS[3],
    Z + '図書館の本は、ただならんでいるのではなく、だれでもさがしやすいように、くふうしてならべられていることが分かりました。こんど図書館に行くときは、ラベルの番号を見て本をさがしたいと思います。',
    BOOK, 'れい　山本花子「図書館のひみつ」〇〇書店、２０２４年、１２ページ'].join('\n');

  // お手本（自作。教科書の文はうつさない: 設計書 §27 と同じ方針。事実の出典は docs/features/setsumei-writing.md）
  var SAMPLE = [Z + Z + Z + 'すがたをかえる葉っぱ', nameLine('高木　北子'),
    Z + '茶の葉には、いろいろな飲み方のくふうがあります。',
    Z + 'まず、つんだ葉をすぐにむして、もんでからかわかすくふうがあります。すぐにねつをくわえると、葉の色が緑のままのこり、緑茶になります。',
    Z + '次に、葉をしばらくおいておくくふうがあります。もんだ葉をおいておくと、色がだんだん茶色にかわっていきます。とちゅうでねつをくわえるとウーロン茶に、さいごまでかえるとこう茶になります。',
    Z + 'さらに、こなにして飲むくふうもあります。おおいをかけて日光をさえぎってそだてた葉を、もまずにむしてかわかし、石うすでひくと、まっ茶になります。',
    Z + 'このように、茶の葉は、くふうされて、いろいろなすがたになって飲まれているのです。'].join('\n');

  function bare(s) { return String(s || '').replace(/[　 ]/g, ''); }
  // 本文の何番目の段落か（line は改行で数えた番号。原稿用紙の「行」とは違うので、児童・先生には段落の番号で言う）
  function paraNo(text, line) { var ls = String(text || '').split('\n'), n = 0; for (var i = 2; i <= line && i < ls.length; i++) if (bare(ls[i])) n++; return n; }
  // 見なおし（要件2）: [{ line, msg }]（line は 0 から。-1 は文章全体）。空の配列なら だいじょうぶ
  //   題名がない・上をあけていない／名前がない／段落のはじめを1マスあけていない／【】の穴が残っている
  function check(text, mode) {
    var lines = String(text || '').split('\n'), out = [], rep = mode === 'report', book = false;
    var t = lines[0] || '', n = lines[1] || '';
    if (!bare(t) || /。/.test(t)) out.push({ line: 0, msg: '1行目に 題名を 書こう', tag: '題名' });
    else if (t.indexOf(Z + Z) !== 0) out.push({ line: 0, msg: '題名は 上を 3マス あけて 書こう', tag: '上を あける' });
    if (!bare(n) || /。/.test(n)) out.push({ line: 1, msg: '2行目に 名前を 書こう', tag: '名前' });
    for (var i = 2; i < lines.length; i++) {
      if (rep && bare(lines[i]) === bare(BOOK)) book = true;
      if (rep && (book || isHead(lines[i]) || isSub(lines[i]))) continue;
      if (bare(lines[i]) && lines[i][0] !== Z) out.push({ line: i, msg: paraNo(text, i) + '番目の 段落：はじめを 1マス あけよう', tag: '1マス あける' });
    }
    if (rep) lines.forEach(function (l, i) { // 見出しの下に まだ何も書いていない
      if (!isHead(l)) return;
      for (var j = i + 1; j < lines.length && !isHead(lines[j]) && bare(lines[j]) !== bare(BOOK); j++) if (bare(lines[j])) return;
      out.push({ line: i, msg: '「' + bare(l).replace(/^[１-９1-9][．.]/, '') + '」を 書こう', tag: '中みを 書く' });
    });
    if (/【[^】]*】/.test(text)) out.push({ line: -1, msg: '【　】の あなを うめよう', tag: 'あな' });
    return out;
  }
  // 題名（一覧に出す名前）
  function title(text) { return bare(String(text || '').split('\n')[0]) || '（題名なし）'; }
  function count(text) { return bare(String(text || '').split('\n').slice(2).join('')).length; } // 本文の字数（題名・名前を除く）
  function paragraphs(text) { return String(text || '').split('\n').slice(2).filter(function (l) { return bare(l); }).length; }

  // 作品の形をそろえる（保存・受け取りの両方で使う）
  var MAX_CHARS = 4000; // 原稿用紙10枚。セルの上限（5万字）に十分届かない
  function normWork(w) {
    w = w || {};
    var o = { id: String(w.id || '').slice(0, 40), text: toZen(String(w.text || '')).slice(0, MAX_CHARS), mode: w.mode === 'free' || w.mode === 'report' ? w.mode : 'tpl', show: !!w.show, updated: Number(w.updated) || 0 };
    o.comments = {};
    if (w.comments && typeof w.comments === 'object') for (var k in w.comments) {
      var c = w.comments[k], line = Number(k);
      if (!(line >= 0 && line < 400) || !c) continue;
      var t = typeof c === 'string' ? c : c.t;
      if (t) o.comments[line] = { t: String(t).slice(0, 200), read: !!(c && c.read), at: Number(c && c.at) || 0 };
    }
    o.fixes = normFixes(w.fixes);
    return o;
  }
  // 段落の順番を入れかえる（line は改行で数えた番号。2行目＝題名・名前の後から）。dir: -1＝前へ（右へ）、+1＝後ろへ（左へ）
  // 返す: { text, map: { もとの行: 新しい行 } }（先生のコメントの付け先を合わせるため）。動かせない時は null
  function moveParagraph(text, line, dir) {
    var ls = String(text || '').split('\n'), to = line + dir;
    if (line < 2 || to < 2 || line >= ls.length || to >= ls.length) return null;
    var t = ls[line]; ls[line] = ls[to]; ls[to] = t;
    var map = {}; map[line] = to; map[to] = line;
    return { text: ls.join('\n'), map: map };
  }
  // コメントの付け先を map で移す（map にない行はそのまま）
  function remapComments(comments, map) {
    var out = {};
    Object.keys(comments || {}).forEach(function (k) { var n = map && (k in map) ? map[k] : Number(k); out[n] = comments[k]; });
    return out;
  }
  // 2つの map を続けて当てた結果（a のあとに b）
  function composeMap(a, b) {
    var res = {}, at = {}, k;
    a = a || {}; b = b || {};
    for (k in a) { var c = Number(a[k]); at[c] = true; res[k] = (c in b) ? Number(b[c]) : c; } // 動いたことのある行
    for (k in b) if (!(k in a) && !at[k]) res[k] = Number(b[k]);                               // まだ動いていない行（もとの位置にいる）
    for (k in res) if (res[k] === Number(k)) delete res[k];
    return res;
  }
  // 先生の修正案（§28 の2回目。W2）: { id, line, start, from, to, at }
  //   line＝改行で数えた段落の番号、start＝その段落の中の何字目（0から）、from＝もとの字、to＝なおした字（空なら消す）。
  //   児童が書きかえても あてはまる所を探せるよう、位置と もとの字の両方を持つ
  function normFixes(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (f) {
      if (!f || out.length >= 100) return;
      var line = Number(f.line), start = Number(f.start), from = String(f.from || '').slice(0, 100), to = toZen(String(f.to == null ? '' : f.to)).replace(/\n/g, '').slice(0, 100);
      if (!(line >= 0 && line < 400) || !(start >= 0 && start < 4000) || !from || from === to) return;
      out.push({ id: String(f.id || '').slice(0, 20) || ('f' + out.length), line: line, start: start, from: from, to: to, at: Number(f.at) || 0 });
    });
    return out;
  }
  // 修正案があてはまる所: { at（本文の中の字の番号）, len }。もとの字が見つからなければ null（児童が書きかえた）
  function fixLocate(text, f) {
    var ls = String(text || '').split('\n');
    if (f.line >= ls.length) return null;
    var l = ls[f.line], base = 0, k;
    for (k = 0; k < f.line; k++) base += ls[k].length + 1;
    if (l.substr(f.start, f.from.length) === f.from) return { at: base + f.start, len: f.from.length };
    var best = -1, bd = 1e9, i = l.indexOf(f.from);
    while (i >= 0) { if (Math.abs(i - f.start) < bd) { bd = Math.abs(i - f.start); best = i; } i = l.indexOf(f.from, i + 1); }
    return best >= 0 ? { at: base + best, len: f.from.length } : null;
  }
  // 修正案を当てた本文（あてはまらなければ null）
  function applyFix(text, f) {
    var p = fixLocate(text, f);
    return p ? String(text).slice(0, p.at) + f.to + String(text).slice(p.at + p.len) : null;
  }
  // 段落の入れかえに合わせて、修正案の段落の番号も移す
  function remapFixes(fixes, map) {
    return (fixes || []).map(function (f) { var o = {}; for (var k in f) o[k] = f[k]; if (map && (f.line in map)) o.line = Number(map[f.line]); return o; });
  }
  function newId() { return 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }

  var Genko = { Z: Z, ROWS: ROWS, COLS: COLS, HANG: HANG, OPEN: OPEN, SMALL: SMALL, MAX_CHARS: MAX_CHARS,
    toZen: toZen, layout: layout, REPORT_HEADS: REPORT_HEADS, BOOK: BOOK, isReport: isReport, reportTemplate: reportTemplate, REPORT_SAMPLE: REPORT_SAMPLE, isHead: isHead, headSig: headSig, isSub: isSub, REPORT_EXAMPLES: REPORT_EXAMPLES, REPORT_STAGES: REPORT_STAGES, normStage: normStage, kumiCheck: kumiCheck, kumiText: kumiText, kumiProblem: kumiProblem, stageOf: stageOf, exSet: exSet, REPORT_SETS: REPORT_SETS, exLines: exLines, reportCopyModel: reportCopyModel, setSection: setSection, pages: pages, nameLine: nameLine, template: template, blank: blank, SAMPLE: SAMPLE,
    check: check, paraNo: paraNo, moveParagraph: moveParagraph, remapComments: remapComments, normFixes: normFixes, fixLocate: fixLocate, applyFix: applyFix, remapFixes: remapFixes, composeMap: composeMap, title: title, count: count, paragraphs: paragraphs, normWork: normWork, newId: newId };
  if (typeof module !== 'undefined' && module.exports) module.exports = Genko; else root.Genko = Genko;
})(typeof globalThis !== "undefined" ? globalThis : this);
