/* ================================================================
   MADING DIGITAL — script.js
   Berisi: navigasi antar-tampilan, game Teka-Teki Silang (Crossword),
   dan game Cari Kata (Word Search) dengan grid yang selalu diacak.
   ================================================================ */

/* ----------------------------------------------------------------
   0. UTILITAS UMUM
   ---------------------------------------------------------------- */

// Mengacak array (Fisher–Yates shuffle) — dipakai supaya setiap
// permainan baru punya urutan kata & posisi yang berbeda.
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Format detik -> "mm:ss"
function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// Membuat timer sederhana yang bisa start/stop/reset dan
// memanggil callback(seconds) setiap detik.
function createTimer(onTick) {
  let seconds = 0;
  let intervalId = null;
  return {
    start() {
      if (intervalId) return;
      intervalId = setInterval(() => {
        seconds++;
        onTick(seconds);
      }, 1000);
    },
    stop() {
      clearInterval(intervalId);
      intervalId = null;
    },
    reset() {
      this.stop();
      seconds = 0;
      onTick(seconds);
    },
    getSeconds() { return seconds; }
  };
}

/* ----------------------------------------------------------------
   1. NAVIGASI ANTAR TAMPILAN (Beranda / Crossword / Word Search)
   ---------------------------------------------------------------- */

const views = document.querySelectorAll('.view');
let crosswordStarted = false;
let wordsearchStarted = false;

function showView(name) {
  views.forEach(v => v.classList.toggle('active', v.id === `view-${name}`));

  // Inisialisasi game hanya sekali (lazy init), lalu jalankan/hentikan timer
  // sesuai tampilan mana yang sedang aktif.
  if (name === 'crossword') {
    if (!crosswordStarted) { initCrossword(); crosswordStarted = true; }
    cwTimer.start();
    wsTimer.stop();
  } else if (name === 'wordsearch') {
    if (!wordsearchStarted) { initWordSearch(); wordsearchStarted = true; }
    wsTimer.start();
    cwTimer.stop();
  } else {
    cwTimer.stop();
    wsTimer.stop();
  }
}

document.querySelectorAll('[data-target]').forEach(el => {
  el.addEventListener('click', () => showView(el.dataset.target));
});

document.getElementById('win-close').addEventListener('click', () => {
  document.getElementById('win-modal').classList.remove('show');
});

// Menyimpan konteks kemenangan saat ini supaya tombol "Simpan Skor" tahu
// game mana, waktu, dan skor mana yang harus dicatat ke leaderboard.
let winContext = { game: null, seconds: 0, score: 0 };

function showWinModal(game, message, seconds, score) {
  winContext = { game, seconds, score };

  document.getElementById('win-message').textContent = message;
  document.getElementById('win-time').textContent = formatTime(seconds);
  document.getElementById('win-score').textContent = score;

  // Reset form simpan nama setiap kali modal dibuka
  const nameInput = document.getElementById('win-name');
  nameInput.value = '';
  document.getElementById('win-save').disabled = false;
  document.getElementById('win-save-msg').textContent = '';

  document.getElementById('win-modal').classList.add('show');
}

document.getElementById('win-save').addEventListener('click', async () => {
  const name = document.getElementById('win-name').value.trim() || 'Anonim';
  const btn = document.getElementById('win-save');
  const msg = document.getElementById('win-save-msg');

  btn.disabled = true;
  msg.textContent = 'Menyimpan...';

  const saved = await saveToLeaderboard(winContext.game, name, winContext.seconds, winContext.score);
  if (saved) {
    msg.textContent = '✅ Skor tersimpan ke leaderboard!';
  } else {
    btn.disabled = false;
    msg.textContent = '❌ Gagal menyimpan. Cek koneksi atau konfigurasi Supabase.';
  }
});

document.getElementById('win-leaderboard').addEventListener('click', () => {
  document.getElementById('win-modal').classList.remove('show');
  showView('leaderboard');
  switchLeaderboardTab(winContext.game || 'crossword');
});


/* ================================================================
   2. GAME 1 — TEKA-TEKI SILANG (CROSSWORD)
   ================================================================ */

// ----- Data soal: setiap entri = satu jawaban di grid -----------
// row/col memakai indeks 0 (baris/kolom paling atas-kiri = 0).
// Cara menambah kata baru: tambahkan objek baru di sini dengan
// row/col/dir yang tepat sehingga hurufnya nyambung dengan kata lain.
const CROSSWORD_WORDS = [
  { num: 1, dir: 'down', row: 0, col: 0, answer: 'BUMI',
    clue: 'Planet tempat kita tinggal, wajib kita jaga' },
  { num: 2, dir: 'down', row: 0, col: 4, answer: 'ALAM',
    clue: 'Segala sesuatu di sekitar kita yang terjadi secara alami' },
  { num: 3, dir: 'down', row: 1, col: 2, answer: 'INDONESIA',
    clue: 'Nama negara kepulauan tercinta kita' },
  { num: 4, dir: 'across', row: 2, col: 0, answer: 'MENJAGA',
    clue: 'Merawat dan melindungi sesuatu agar tetap baik, misalnya ___ lingkungan' },
  { num: 5, dir: 'down', row: 4, col: 6, answer: 'HIJAU',
    clue: 'Warna yang identik dengan alam dan lingkungan yang sehat' },
  { num: 6, dir: 'across', row: 5, col: 0, answer: 'TANAHAIR',
    clue: 'Sebutan untuk negeri kelahiran atau tempat asal kita (2 kata, tulis tanpa spasi)' },
  { num: 7, dir: 'across', row: 7, col: 0, answer: 'NUSANTARA',
    clue: 'Sebutan untuk gugusan ribuan pulau yang membentuk Indonesia' },
];

// Variabel state game crossword
let cwGrid = [];          // grid solusi: cwGrid[r][c] = huruf atau null (blok)
let cwRows = 0, cwCols = 0;
let cwAcrossMap = [];      // cwAcrossMap[r][c] = index kata "across" di CROSSWORD_WORDS
let cwDownMap = [];
let cwNumberAt = {};        // "r_c" -> nomor petunjuk
let cwActiveCell = null;    // {r,c}
let cwCurrentDir = 'across';
let cwCurrentWordIdx = null;
let cwScore = 0;
let cwWon = false;

const cwTimer = createTimer(sec => {
  document.getElementById('cw-timer').textContent = formatTime(sec);
});

// Membangun grid solusi & peta kata dari CROSSWORD_WORDS
function buildCrosswordData() {
  let maxRow = 0, maxCol = 0;
  CROSSWORD_WORDS.forEach(w => {
    if (w.dir === 'across') {
      maxRow = Math.max(maxRow, w.row);
      maxCol = Math.max(maxCol, w.col + w.answer.length - 1);
    } else {
      maxRow = Math.max(maxRow, w.row + w.answer.length - 1);
      maxCol = Math.max(maxCol, w.col);
    }
  });
  cwRows = maxRow + 1;
  cwCols = maxCol + 1;

  cwGrid = Array.from({ length: cwRows }, () => Array(cwCols).fill(null));
  cwAcrossMap = Array.from({ length: cwRows }, () => Array(cwCols).fill(null));
  cwDownMap = Array.from({ length: cwRows }, () => Array(cwCols).fill(null));
  cwNumberAt = {};

  CROSSWORD_WORDS.forEach((w, idx) => {
    for (let i = 0; i < w.answer.length; i++) {
      const r = w.dir === 'across' ? w.row : w.row + i;
      const c = w.dir === 'across' ? w.col + i : w.col;
      cwGrid[r][c] = w.answer[i];
      if (w.dir === 'across') cwAcrossMap[r][c] = idx; else cwDownMap[r][c] = idx;
    }
    cwNumberAt[`${w.row}_${w.col}`] = w.num;
  });
}

// Merender grid crossword ke dalam #crossword-grid
function renderCrosswordGrid() {
  const gridEl = document.getElementById('crossword-grid');
  gridEl.innerHTML = '';
  gridEl.style.setProperty('--cw-cols', cwCols);
  gridEl.style.setProperty('--cw-rows', cwRows);
  gridEl.style.gridTemplateColumns = `repeat(${cwCols}, 1fr)`;
  gridEl.style.gridTemplateRows = `repeat(${cwRows}, 1fr)`;

  for (let r = 0; r < cwRows; r++) {
    for (let c = 0; c < cwCols; c++) {
      const cellEl = document.createElement('div');
      if (cwGrid[r][c] === null) {
        cellEl.className = 'cw-cell blocked';
      } else {
        cellEl.className = 'cw-cell active';
        const num = cwNumberAt[`${r}_${c}`];
        if (num) {
          const numSpan = document.createElement('span');
          numSpan.className = 'cell-num';
          numSpan.textContent = num;
          cellEl.appendChild(numSpan);
        }
        const input = document.createElement('input');
        input.maxLength = 1;
        input.autocomplete = 'off';
        input.inputMode = 'text';
        input.dataset.r = r;
        input.dataset.c = c;

        input.addEventListener('focus', () => selectCwCell(r, c));
        input.addEventListener('click', () => selectCwCell(r, c, null, true));
        input.addEventListener('input', (e) => onCwInput(e, r, c));
        input.addEventListener('keydown', (e) => onCwKeydown(e, r, c));

        cellEl.appendChild(input);
      }
      gridEl.appendChild(cellEl);
    }
  }
}

// Merender daftar petunjuk (mendatar & menurun)
function renderCrosswordClues() {
  const acrossEl = document.getElementById('clues-across');
  const downEl = document.getElementById('clues-down');
  acrossEl.innerHTML = '';
  downEl.innerHTML = '';

  CROSSWORD_WORDS.forEach((w, idx) => {
    const li = document.createElement('li');
    li.dataset.idx = idx;
    li.innerHTML = `<b>${w.num}.</b> ${w.clue} (${w.answer.length} huruf)`;
    li.addEventListener('click', () => {
      selectCwCell(w.row, w.col, w.dir);
    });
    (w.dir === 'across' ? acrossEl : downEl).appendChild(li);
  });
}

function cwInputEl(r, c) {
  return document.querySelector(`#crossword-grid input[data-r="${r}"][data-c="${c}"]`);
}

// Memilih sebuah kotak: menentukan arah aktif (across/down),
// menyorot seluruh kata yang sesuai & petunjuknya.
function selectCwCell(r, c, forceDir, isClickToggle) {
  const hasAcross = cwAcrossMap[r][c] !== null;
  const hasDown = cwDownMap[r][c] !== null;
  let dir = forceDir;

  if (!dir) {
    const sameCell = cwActiveCell && cwActiveCell.r === r && cwActiveCell.c === c;
    if (isClickToggle && sameCell && hasAcross && hasDown) {
      // klik kotak yang sama & kotak itu punya 2 arah -> tukar arah
      dir = cwCurrentDir === 'across' ? 'down' : 'across';
    } else if (cwCurrentDir === 'across' && hasAcross) {
      dir = 'across';
    } else if (cwCurrentDir === 'down' && hasDown) {
      dir = 'down';
    } else {
      dir = hasAcross ? 'across' : 'down';
    }
  }

  cwCurrentDir = dir;
  cwActiveCell = { r, c };
  cwCurrentWordIdx = dir === 'across' ? cwAcrossMap[r][c] : cwDownMap[r][c];

  highlightCwWord();
  const el = cwInputEl(r, c);
  if (el) el.focus();
}

function highlightCwWord() {
  document.querySelectorAll('.cw-cell.active').forEach(el => {
    el.classList.remove('in-word', 'current');
  });
  document.querySelectorAll('.clue-group li').forEach(li => li.classList.remove('active-clue'));

  if (cwCurrentWordIdx === null) return;
  const w = CROSSWORD_WORDS[cwCurrentWordIdx];
  for (let i = 0; i < w.answer.length; i++) {
    const r = w.dir === 'across' ? w.row : w.row + i;
    const c = w.dir === 'across' ? w.col + i : w.col;
    const cellDiv = cwInputEl(r, c)?.closest('.cw-cell');
    if (cellDiv) cellDiv.classList.add('in-word');
  }
  const curDiv = cwInputEl(cwActiveCell.r, cwActiveCell.c)?.closest('.cw-cell');
  if (curDiv) curDiv.classList.add('current');

  const li = document.querySelector(`.clue-group li[data-idx="${cwCurrentWordIdx}"]`);
  if (li) li.classList.add('active-clue');
}

// Berpindah ke kotak berikutnya sesuai arah saat ini
function moveCwNext(r, c) {
  const nr = cwCurrentDir === 'down' ? r + 1 : r;
  const nc = cwCurrentDir === 'across' ? c + 1 : c;
  if (nr < cwRows && nc < cwCols && cwGrid[nr] && cwGrid[nr][nc] !== null && cwGrid[nr][nc] !== undefined) {
    selectCwCell(nr, nc, cwCurrentDir);
  }
}
function moveCwPrev(r, c) {
  const pr = cwCurrentDir === 'down' ? r - 1 : r;
  const pc = cwCurrentDir === 'across' ? c - 1 : c;
  if (pr >= 0 && pc >= 0 && cwGrid[pr] && cwGrid[pr][pc] !== null && cwGrid[pr][pc] !== undefined) {
    selectCwCell(pr, pc, cwCurrentDir);
  }
}

function onCwInput(e, r, c) {
  let val = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
  e.target.value = val.slice(-1);
  e.target.closest('.cw-cell').classList.remove('correct', 'incorrect', 'hinted');
  if (e.target.value) moveCwNext(r, c);
  checkCwSilently();
}

function onCwKeydown(e, r, c) {
  if (e.key === 'Backspace' && !e.target.value) {
    e.preventDefault();
    moveCwPrev(r, c);
    const prevEl = document.activeElement;
    if (prevEl && prevEl.tagName === 'INPUT') {
      prevEl.value = '';
      prevEl.closest('.cw-cell').classList.remove('correct', 'incorrect', 'hinted');
    }
  } else if (e.key === 'ArrowRight') { e.preventDefault(); trySelect(r, c + 1, 'across'); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); trySelect(r, c - 1, 'across'); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); trySelect(r + 1, c, 'down'); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); trySelect(r - 1, c, 'down'); }
}

function trySelect(r, c, dir) {
  if (r >= 0 && r < cwRows && c >= 0 && c < cwCols && cwGrid[r][c] !== null) {
    selectCwCell(r, c, dir);
  }
}

// Mengecek jawaban tanpa menampilkan feedback visual (dipakai tiap ketikan
// untuk mendeteksi kemenangan secara otomatis & memperbarui skor)
function checkCwSilently() {
  let correctWords = 0;
  CROSSWORD_WORDS.forEach(w => {
    let ok = true;
    for (let i = 0; i < w.answer.length; i++) {
      const r = w.dir === 'across' ? w.row : w.row + i;
      const c = w.dir === 'across' ? w.col + i : w.col;
      const el = cwInputEl(r, c);
      if (!el || el.value !== w.answer[i]) { ok = false; break; }
    }
    if (ok) correctWords++;
  });
  cwScore = correctWords * 10;
  document.getElementById('cw-score').textContent = cwScore;

  if (correctWords === CROSSWORD_WORDS.length && !cwWon) {
    cwWon = true;
    cwTimer.stop();
    showWinModal('crossword', 'Kamu berhasil menyelesaikan teka-teki silang!', cwTimer.getSeconds(), cwScore);
  }
}

// Tombol "Check Answer": beri warna benar/salah di tiap kotak
document.getElementById('cw-check').addEventListener('click', () => {
  let correct = 0, total = 0;
  document.querySelectorAll('#crossword-grid .cw-cell.active').forEach(cellDiv => {
    const input = cellDiv.querySelector('input');
    const r = +input.dataset.r, c = +input.dataset.c;
    total++;
    cellDiv.classList.remove('correct', 'incorrect');
    if (!input.value) return;
    if (input.value === cwGrid[r][c]) {
      cellDiv.classList.add('correct');
      correct++;
    } else {
      cellDiv.classList.add('incorrect');
    }
  });
  const feedback = document.getElementById('cw-feedback');
  feedback.textContent = `${correct} dari ${total} kotak sudah benar.`;
  feedback.classList.toggle('bad', correct < total);

  // Hilangkan tanda "incorrect" setelah beberapa saat agar bisa dicoba lagi
  setTimeout(() => {
    document.querySelectorAll('#crossword-grid .cw-cell.incorrect').forEach(el => el.classList.remove('incorrect'));
  }, 1600);
});

// Tombol "Hint": ungkap satu huruf yang masih kosong/salah
document.getElementById('cw-hint').addEventListener('click', () => {
  for (let r = 0; r < cwRows; r++) {
    for (let c = 0; c < cwCols; c++) {
      if (cwGrid[r][c] === null) continue;
      const input = cwInputEl(r, c);
      if (input.value !== cwGrid[r][c]) {
        input.value = cwGrid[r][c];
        input.closest('.cw-cell').classList.add('hinted');
        checkCwSilently();
        return;
      }
    }
  }
});

// Tombol "Reset"
document.getElementById('cw-reset').addEventListener('click', resetCrossword);

function resetCrossword() {
  document.querySelectorAll('#crossword-grid input').forEach(inp => { inp.value = ''; });
  document.querySelectorAll('#crossword-grid .cw-cell').forEach(el =>
    el.classList.remove('correct', 'incorrect', 'hinted', 'in-word', 'current'));
  document.getElementById('cw-feedback').textContent = '';
  cwScore = 0;
  cwWon = false;
  document.getElementById('cw-score').textContent = '0';
  cwTimer.reset();
  cwTimer.start();
  const first = CROSSWORD_WORDS[0];
  selectCwCell(first.row, first.col, first.dir);
}

function initCrossword() {
  buildCrosswordData();
  renderCrosswordGrid();
  renderCrosswordClues();
  const first = CROSSWORD_WORDS[0];
  selectCwCell(first.row, first.col, first.dir);
}


/* ================================================================
   3. GAME 2 — CARI KATA (WORD SEARCH)
   ================================================================ */

// ----- Konfigurasi: ubah di sini untuk menyesuaikan permainan -----
const WORDSEARCH_WORDS = [
  'ALAM', 'HUTAN', 'POHON', 'SAMPAH', 'HIJAU', 'BUMI', 'SUNGAI',
  'POLUSI', 'DAURULANG', 'CINTA', 'NEGARA', 'INDONESIA', 'HEMAT',
  'LESTARI'
];
const WS_SIZE = 14;              // ukuran grid (14 x 14)
const WS_MAX_ATTEMPTS_PER_WORD = 300; // percobaan posisi acak per kata
const WS_MAX_PUZZLE_ATTEMPTS = 40;    // percobaan membangun ulang seluruh puzzle

// 8 arah: [deltaRow, deltaCol] -> kanan, kiri, bawah, atas, & 4 diagonal
const WS_DIRECTIONS = [
  [0, 1], [0, -1], [1, 0], [-1, 0],
  [1, 1], [1, -1], [-1, 1], [-1, -1]
];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

let wsGrid = [];          // huruf yang tampil di layar
let wsPlacements = [];    // [{word, cells:[{r,c},...]}]
let wsFoundWords = new Set();
let wsScore = 0;
let wsWon = false;

const wsTimer = createTimer(sec => {
  document.getElementById('ws-timer').textContent = formatTime(sec);
});

/* ----------------------------------------------------------------
   3.1 ALGORITMA PEMBUATAN GRID ACAK
   Langkah (sesuai permintaan):
   1. Ambil daftar kata & acak urutannya
   2. Untuk tiap kata: coba posisi & arah acak berulang kali
   3. Cek apakah kata muat di dalam grid (tidak keluar batas)
   4. Cek apakah tidak bertabrakan dengan huruf berbeda
   5. Jika gagal setelah banyak percobaan, ulangi dari awal (retry)
   6. Jika semua kata berhasil ditempatkan, isi sisa kotak kosong
      dengan huruf acak
   ---------------------------------------------------------------- */
function generateWordSearchPuzzle() {
  for (let attempt = 0; attempt < WS_MAX_PUZZLE_ATTEMPTS; attempt++) {
    const grid = Array.from({ length: WS_SIZE }, () => Array(WS_SIZE).fill(null));
    const placements = [];
    const words = shuffleArray(WORDSEARCH_WORDS);
    let allPlaced = true;

    for (const word of words) {
      let placed = false;

      for (let t = 0; t < WS_MAX_ATTEMPTS_PER_WORD; t++) {
        const [dr, dc] = WS_DIRECTIONS[Math.floor(Math.random() * WS_DIRECTIONS.length)];
        const startRow = Math.floor(Math.random() * WS_SIZE);
        const startCol = Math.floor(Math.random() * WS_SIZE);
        const endRow = startRow + dr * (word.length - 1);
        const endCol = startCol + dc * (word.length - 1);

        // 3. Kata harus tetap di dalam batas grid
        if (endRow < 0 || endRow >= WS_SIZE || endCol < 0 || endCol >= WS_SIZE) continue;

        // 4. Cek tabrakan huruf
        let fits = true;
        const cells = [];
        for (let i = 0; i < word.length; i++) {
          const r = startRow + dr * i;
          const c = startCol + dc * i;
          const existing = grid[r][c];
          if (existing !== null && existing !== word[i]) { fits = false; break; }
          cells.push({ r, c });
        }
        if (!fits) continue;

        // Posisi valid -> tempatkan kata di grid
        cells.forEach((cell, i) => { grid[cell.r][cell.c] = word[i]; });
        placements.push({ word, cells });
        placed = true;
        break;
      }

      if (!placed) { allPlaced = false; break; } // 5. gagal -> bangun ulang seluruh puzzle
    }

    if (allPlaced) {
      // 6. Isi sisa kotak kosong dengan huruf acak
      for (let r = 0; r < WS_SIZE; r++) {
        for (let c = 0; c < WS_SIZE; c++) {
          if (grid[r][c] === null) {
            grid[r][c] = ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
          }
        }
      }
      return { grid, placements };
    }
    // allPlaced === false -> loop mencoba attempt berikutnya dari awal
  }

  // Fallback yang sangat jarang terjadi: coba lagi dengan grid lebih besar
  // sementara supaya kata tetap muat.
  console.warn('Gagal membangun puzzle setelah banyak percobaan, mencoba grid darurat.');
  return generateEmergencyPuzzle();
}

// Fallback ekstra-aman jika (sangat jarang) semua percobaan normal gagal
function generateEmergencyPuzzle() {
  const size = WS_SIZE + 4;
  const grid = Array.from({ length: size }, () => Array(size).fill(null));
  const placements = [];
  WORDSEARCH_WORDS.forEach((word, idx) => {
    const r = idx % size;
    for (let i = 0; i < word.length && (idx + i) < size; i++) {
      grid[r][i] = word[i];
    }
    placements.push({ word, cells: word.split('').map((_, i) => ({ r, c: i })) });
  });
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (grid[r][c] === null) grid[r][c] = ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return { grid, placements };
}

/* ----------------------------------------------------------------
   3.2 RENDER GRID & DAFTAR KATA
   ---------------------------------------------------------------- */
function renderWordSearch() {
  const size = wsGrid.length;
  const gridEl = document.getElementById('ws-grid');
  gridEl.innerHTML = '';
  gridEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  gridEl.style.gridTemplateRows = `repeat(${size}, 1fr)`;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = document.createElement('div');
      cell.className = 'ws-cell';
      cell.textContent = wsGrid[r][c];
      cell.dataset.r = r;
      cell.dataset.c = c;
      gridEl.appendChild(cell);
    }
  }

  const listEl = document.getElementById('ws-word-list');
  listEl.innerHTML = '';
  WORDSEARCH_WORDS.forEach(word => {
    const li = document.createElement('li');
    li.textContent = word;
    li.dataset.word = word;
    listEl.appendChild(li);
  });

  document.getElementById('ws-total').textContent = WORDSEARCH_WORDS.length;
  document.getElementById('ws-found').textContent = 0;
  document.getElementById('ws-score').textContent = 0;
}

function wsCellEl(r, c) {
  return document.querySelector(`#ws-grid .ws-cell[data-r="${r}"][data-c="${c}"]`);
}

/* ----------------------------------------------------------------
   3.3 INTERAKSI PEMILIHAN KATA (mouse & touch via Pointer Events)
   Mendukung: klik-seret (drag), atau klik huruf awal lalu huruf akhir.
   ---------------------------------------------------------------- */
let wsSelecting = false;   // sedang menyeret?
let wsPending = false;     // menunggu tap kedua (mode klik-klik)
let wsStartCell = null;
let wsCurrentCell = null;

function cellFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const cellDiv = el && el.closest ? el.closest('.ws-cell') : null;
  if (!cellDiv) return null;
  return { r: +cellDiv.dataset.r, c: +cellDiv.dataset.c };
}

function clearWsPreview() {
  document.querySelectorAll('.ws-cell.preview').forEach(el => el.classList.remove('preview'));
}

function pathBetween(start, end) {
  const dr = end.r - start.r, dc = end.c - start.c;
  const isStraight = dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc);
  if (!isStraight) return null;
  const steps = Math.max(Math.abs(dr), Math.abs(dc));
  const stepR = Math.sign(dr), stepC = Math.sign(dc);
  const path = [];
  for (let i = 0; i <= steps; i++) path.push({ r: start.r + stepR * i, c: start.c + stepC * i });
  return path;
}

function previewPath(start, end) {
  clearWsPreview();
  const path = pathBetween(start, end);
  if (!path) return;
  path.forEach(({ r, c }) => {
    const el = wsCellEl(r, c);
    if (el && !el.classList.contains('found')) el.classList.add('preview');
  });
}

function wordSearchAttach() {
  const gridEl = document.getElementById('ws-grid');

  gridEl.addEventListener('pointerdown', (e) => {
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (!cell) return;
    e.preventDefault();

    if (wsPending && wsStartCell) {
      // Tap kedua -> selesaikan pemilihan dari mode klik-klik
      finalizeWsSelection(wsStartCell, cell);
      wsPending = false;
      wsStartCell = null;
      return;
    }

    wsSelecting = true;
    wsStartCell = cell;
    wsCurrentCell = cell;
    previewPath(cell, cell);
  });

  gridEl.addEventListener('pointermove', (e) => {
    if (!wsSelecting) return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (!cell) return;
    if (!wsCurrentCell || cell.r !== wsCurrentCell.r || cell.c !== wsCurrentCell.c) {
      wsCurrentCell = cell;
      previewPath(wsStartCell, cell);
    }
  });

  const endDrag = (e) => {
    if (!wsSelecting) return;
    wsSelecting = false;
    const moved = wsCurrentCell && (wsCurrentCell.r !== wsStartCell.r || wsCurrentCell.c !== wsStartCell.c);
    if (moved) {
      finalizeWsSelection(wsStartCell, wsCurrentCell);
      wsStartCell = null;
      wsCurrentCell = null;
    } else {
      // Tidak ada gerakan -> anggap ini tap pertama, tunggu tap kedua
      wsPending = true;
    }
  };
  gridEl.addEventListener('pointerup', endDrag);
  gridEl.addEventListener('pointercancel', endDrag);
}

function finalizeWsSelection(start, end) {
  const path = pathBetween(start, end);
  clearWsPreview();
  if (!path || path.length < 2) return;

  const letters = path.map(({ r, c }) => wsGrid[r][c]).join('');
  const reversed = letters.split('').reverse().join('');

  const match = wsPlacements.find(p =>
    !wsFoundWords.has(p.word) && (p.word === letters || p.word === reversed)
  );

  if (match) {
    wsFoundWords.add(match.word);
    path.forEach(({ r, c }) => wsCellEl(r, c).classList.add('found'));
    const li = document.querySelector(`#ws-word-list li[data-word="${match.word}"]`);
    if (li) li.classList.add('done');

    wsScore += 10;
    document.getElementById('ws-score').textContent = wsScore;
    document.getElementById('ws-found').textContent = wsFoundWords.size;

    if (wsFoundWords.size === WORDSEARCH_WORDS.length && !wsWon) {
      wsWon = true;
      wsTimer.stop();
      showWinModal('wordsearch', 'Kamu berhasil menemukan semua kata!', wsTimer.getSeconds(), wsScore);
    }
  } else {
    // Bukan kata yang benar -> beri kedipan merah singkat
    path.forEach(({ r, c }) => wsCellEl(r, c).classList.add('invalid'));
    setTimeout(() => {
      path.forEach(({ r, c }) => wsCellEl(r, c)?.classList.remove('invalid'));
    }, 350);
  }
}

/* ----------------------------------------------------------------
   3.4 TOMBOL & INISIALISASI
   ---------------------------------------------------------------- */
document.getElementById('ws-new').addEventListener('click', newWordSearchGame);
document.getElementById('ws-reset').addEventListener('click', resetWordSearchProgress);

function newWordSearchGame() {
  const puzzle = generateWordSearchPuzzle();
  wsGrid = puzzle.grid;
  wsPlacements = puzzle.placements;
  wsFoundWords = new Set();
  wsScore = 0;
  wsWon = false;
  renderWordSearch();
  wsTimer.reset();
  wsTimer.start();
}

// Reset hanya mengulang progres di puzzle YANG SAMA (grid tidak berubah)
function resetWordSearchProgress() {
  wsFoundWords = new Set();
  wsScore = 0;
  wsWon = false;
  document.querySelectorAll('#ws-grid .ws-cell').forEach(el => el.classList.remove('found', 'preview', 'invalid'));
  document.querySelectorAll('#ws-word-list li').forEach(li => li.classList.remove('done'));
  document.getElementById('ws-score').textContent = 0;
  document.getElementById('ws-found').textContent = 0;
  wsTimer.reset();
  wsTimer.start();
}

function initWordSearch() {
  wordSearchAttach();
  newWordSearchGame();
}


/* ================================================================
   4. LEADERBOARD — Supabase (online, semua device)
   ================================================================
   GANTI dua nilai di bawah dengan Project URL dan anon/public key
   dari Supabase. JANGAN pernah memasukkan service_role key di sini.
   ---------------------------------------------------------------- */

const SUPABASE_URL = 'https://fcetqqzeffphwycfcmaf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Jgb2vSIsnPL6T8b6Lxlhig_cRYRbUe5';

const LB_MAX_ENTRIES = 10;
let lbActiveTab = 'crossword';
let lbLastSavedTimestamp = null;

function supabaseReady() {
  return SUPABASE_URL.includes('.supabase.co') &&
         SUPABASE_ANON_KEY &&
         SUPABASE_ANON_KEY.length > 50;
}

function supabaseReady() {
  return SUPABASE_URL.includes('.supabase.co') &&
         SUPABASE_ANON_KEY &&
         SUPABASE_ANON_KEY.length > 50;
}

async function getLeaderboard(game) {
  if (!supabaseReady()) {
    console.error('Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_ANON_KEY di script.js.');
    return [];
  }

  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/leaderboard`);
    url.searchParams.set('game', `eq.${game}`);
    url.searchParams.set('select', 'id,game,name,seconds,score,ts');
    url.searchParams.set('order', 'seconds.asc,score.desc');
    url.searchParams.set('limit', String(LB_MAX_ENTRIES));

    const response = await fetch(url, {
      method: 'GET',
      headers: supabaseHeaders()
    });

    if (!response.ok) {
      console.error('Supabase GET error:', await response.text());
      return [];
    }

    return await response.json();
  } catch (e) {
    console.error('Gagal mengambil leaderboard:', e);
    return [];
  }
}

async function saveToLeaderboard(game, name, seconds, score) {
  if (!supabaseReady()) {
    console.error('Supabase belum dikonfigurasi.');
    return false;
  }

  const entry = {
    game,
    name: name.slice(0, 18),
    seconds: Math.max(0, Math.floor(seconds)),
    score: Math.floor(score),
    ts: Date.now()
  };

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/leaderboard`, {
      method: 'POST',
      headers: supabaseHeaders({ 'Prefer': 'return=minimal' }),
      body: JSON.stringify(entry)
    });

    if (!response.ok) {
      console.error('Supabase POST error:', await response.text());
      return false;
    }

    lbLastSavedTimestamp = entry.ts;
    await renderLeaderboard(game);
    return true;
  } catch (e) {
    console.error('Gagal menyimpan leaderboard:', e);
    return false;
  }
}

async function renderLeaderboard(game) {
  lbActiveTab = game;
  const listEl = document.getElementById('lb-list');
  const emptyEl = document.getElementById('lb-empty');

  document.querySelectorAll('.lb-tab').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.lb === game));

  listEl.innerHTML = '<li class="lb-loading">Memuat leaderboard...</li>';

  const data = await getLeaderboard(game);
  listEl.innerHTML = '';

  if (data.length === 0) {
    emptyEl.hidden = false;
    emptyEl.textContent = supabaseReady()
      ? 'Belum ada skor untuk game ini.'
      : 'Leaderboard belum dikonfigurasi. Isi Supabase URL dan anon key di script.js.';
    return;
  }

  emptyEl.hidden = true;

  const medals = ['🥇', '🥈', '🥉'];
  data.forEach((entry, i) => {
    const li = document.createElement('li');
    if (entry.ts === lbLastSavedTimestamp) li.classList.add('you');
    li.innerHTML = `
      <span class="lb-rank">${medals[i] || (i + 1)}</span>
      <span class="lb-name">${escapeHtml(entry.name)}</span>
      <span class="lb-time">⏱ ${formatTime(entry.seconds)}</span>
      <span class="lb-score">⭐ ${entry.score}</span>
    `;
    listEl.appendChild(li);
  });
}

// Mencegah nama pemain menyisipkan tag HTML ke halaman
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function switchLeaderboardTab(game) {
  renderLeaderboard(game);
}

document.querySelectorAll('.lb-tab').forEach(btn => {
  btn.addEventListener('click', () => switchLeaderboardTab(btn.dataset.lb));
});

// Saat masuk ke halaman leaderboard lewat tombol beranda, ambil data terbaru dari Supabase.
document.querySelectorAll('[data-target="leaderboard"]').forEach(el => {
  el.addEventListener('click', () => renderLeaderboard(lbActiveTab));
});
