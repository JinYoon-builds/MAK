/* ============================================================
   MAK 키오스크 — 화면 전환 / 프로토타입 데모 컨트롤
   (음성·API 없음: 마이크/버튼 클릭이 인식을 시뮬레이션)
   ============================================================ */
(function () {
  'use strict';

  var KW = 810, KH = 1440, BEZEL = 44; // screen + bezel padding

  // 정상(happy-path) 흐름 순서
  var HAPPY = ['dest', 'confirm', 'time', 'summary', 'searching', 'results', 'done'];
  var LABEL = {
    dest: '목적지 듣기', confirm: '목적지 확인', time: '시간 듣기',
    summary: '요약 확인', searching: '표 찾는 중', results: '결과', done: '발권 완료',
    nudge: '먼저 말 걸기', idle: '자리 비움 확인', retry: '되묻기', staff: '직원 연결 제안'
  };

  var screens = {};
  document.querySelectorAll('.screen').forEach(function (el) {
    screens[el.dataset.screen] = el;
  });

  var current = 'dest';
  var searchTimer = null, idleTimer = null;

  function clearTimers() {
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
    if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
  }

  function show(id) {
    if (!screens[id]) return;
    clearTimers();
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('is-active', k === id);
    });
    current = id;
    updateControls();

    // searching → 자동으로 결과로 (실제로는 API 응답)
    if (id === 'searching') {
      searchTimer = setTimeout(function () { show('results'); }, 2600);
    }
    // idle → 카운트다운 후 첫 화면 리셋
    if (id === 'idle') {
      runIdleCountdown();
    }
  }

  function runIdleCountdown() {
    var el = document.getElementById('idleCount');
    var n = 10;
    if (el) el.textContent = n;
    idleTimer = setInterval(function () {
      n -= 1;
      if (el) el.textContent = n;
      if (n <= 0) { clearInterval(idleTimer); idleTimer = null; show('dest'); }
    }, 1000);
  }

  function updateControls() {
    var label = document.getElementById('navLabel');
    var index = document.getElementById('navIndex');
    label.textContent = LABEL[current] || current;
    var i = HAPPY.indexOf(current);
    if (i >= 0) {
      index.textContent = '정상 흐름 ' + (i + 1) + ' / ' + HAPPY.length;
    } else {
      index.textContent = '안전망 화면';
    }
  }

  // ---- click delegation: any [data-go] navigates ----
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-go]');
    if (!t) return;
    e.preventDefault();
    show(t.dataset.go);
  });

  // ---- prev / next through happy path ----
  document.getElementById('prev').addEventListener('click', function () {
    var i = HAPPY.indexOf(current);
    if (i === -1) { show('dest'); return; }
    show(HAPPY[Math.max(0, i - 1)]);
  });
  document.getElementById('next').addEventListener('click', function () {
    var i = HAPPY.indexOf(current);
    if (i === -1) { show('dest'); return; }
    show(HAPPY[Math.min(HAPPY.length - 1, i + 1)]);
  });

  // keyboard arrows
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') document.getElementById('next').click();
    if (e.key === 'ArrowLeft') document.getElementById('prev').click();
  });

  // ---- responsive scaling (letterbox the fixed kiosk) ----
  var scaler = document.getElementById('scaler');
  var fitbox = document.getElementById('fitbox');
  var totalW = KW + 44; // bezel = screen + padding 22*2
  var totalH = KH + 44;
  function fit() {
    var wrap = document.querySelector('.stage-scroll');
    var availW = wrap.clientWidth - 52;
    var availH = wrap.clientHeight - 52;
    var s = Math.min(availW / totalW, availH / totalH);
    scaler.style.transform = 'scale(' + s + ')';
    fitbox.style.width = (totalW * s) + 'px';
    fitbox.style.height = (totalH * s) + 'px';
  }
  window.addEventListener('resize', fit);
  fit();

  updateControls();
})();
