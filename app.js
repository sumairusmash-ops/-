// ==========================================
// Firebase設定（★ここにキーを入れます）
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyCDIcsuYRabzTNm1QC93ecV5YKkExenseI",
  authDomain: "pachinco-fb565.firebaseapp.com",
  projectId: "pachinco-fb565",
  storageBucket: "pachinco-fb565.firebasestorage.app",
  messagingSenderId: "695101913449",
  appId: "1:695101913449:web:f5612d814b68dbb5bea5f8"
};

if(firebaseConfig.apiKey !== "YOUR_API_KEY") {
  firebase.initializeApp(firebaseConfig);
  firebase.firestore().enablePersistence().catch((err) => {
    console.log("Offline persistence error: ", err.code);
  });
}

const auth = firebase.apps.length ? firebase.auth() : null;
const db = firebase.apps.length ? firebase.firestore() : null;

// PWAサービスワーカーの登録
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.log('SW registration failed: ', err);
    });
  });
}

let currentUser = null;
let currentGroupId = localStorage.getItem('pachinko_groupId') || null;
let isAdmin = false; 

let lastCalculatedEV = 0; 
let historyData = [];
let currentPassData = null; 
let editingRecordId = null; 
let slumpChartInstance = null; 

let currentCalYear = new Date().getFullYear();
let currentCalMonth = new Date().getMonth();

let unsubscribeGroup = null;
let globalGroupData = { records: [], calendar: {}, dictionary: {} };
let measurementStartTime = null; 

// ==========================================
// ユーティリティ・UI機能
// ==========================================
function toggleDarkMode() {
  const isDark = document.getElementById('darkModeToggle').checked;
  if (isDark) { document.body.setAttribute('data-theme', 'dark'); localStorage.setItem('pachinko_theme', 'dark'); } 
  else { document.body.removeAttribute('data-theme'); localStorage.setItem('pachinko_theme', 'light'); }
}

function vibrate(ms = 40) { if (navigator.vibrate) navigator.vibrate(ms); }

function openResultModal() { document.getElementById('resultModal').style.display = 'flex'; }
function closeResultModal() { document.getElementById('resultModal').style.display = 'none'; }
function openSavedModal() { renderSavedRecords(); document.getElementById('savedModal').style.display = 'flex'; }
function closeSavedModal() { document.getElementById('savedModal').style.display = 'none'; }

const resultModal = document.getElementById('resultModal');
const savedModal = document.getElementById('savedModal');
resultModal.addEventListener('click', function(e) { if (e.target === resultModal) closeResultModal(); });
savedModal.addEventListener('click', function(e) { if (e.target === savedModal) closeSavedModal(); });


// ==========================================
// ★ スワイプ機能（透明バリア方式による誤作動完全防止）
// ==========================================
function setupSwipeInput(id, step, min, max, defaultVal) {
  const input = document.getElementById(id);
  if (!input || input.hasAttribute('data-swipe-init')) return;
  input.setAttribute('data-swipe-init', 'true');

  // 1. 透明なバリア（オーバーレイ）の作成
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.display = 'block';
  
  // inputをwrapperで囲む
  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(input);
  
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  overlay.style.top = '0'; overlay.style.left = '0';
  overlay.style.width = '100%'; overlay.style.height = '100%';
  overlay.style.zIndex = '10';
  overlay.style.cursor = 'ew-resize';
  overlay.style.touchAction = 'none'; // ネイティブスクロール防止
  wrapper.appendChild(overlay);

  // 2. スワイプ処理（対象は input ではなく overlay）
  let isDragging = false;
  let startX = 0;
  let startVal = 0;
  let hasMoved = false; // スワイプかタップかの判定用

  const onStart = (e) => {
    isDragging = true;
    hasMoved = false;
    startX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    let def = typeof defaultVal === 'function' ? defaultVal() : defaultVal;
    if (input.value === "") {
      let decimals = step.toString().includes('.') ? step.toString().split('.')[1].length : 0;
      input.value = Number(def).toFixed(decimals);
      input.classList.remove('auto-filled');
      if (input.oninput) input.oninput();
    }
    startVal = parseFloat(input.value);
    if (isNaN(startVal)) startVal = def;
  };
  
  overlay.addEventListener('mousedown', onStart);
  overlay.addEventListener('touchstart', onStart, {passive: true});
  
  const onMove = (e) => {
    if (!isDragging) return;
    if (e.cancelable) e.preventDefault(); // スワイプ中の画面スクロールを完全にブロック
    
    let clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    let deltaX = clientX - startX;
    
    // 5px以上指が動いたら「スワイプ操作」と判定する
    if (Math.abs(deltaX) > 5) hasMoved = true; 

    let steps = Math.trunc(deltaX / 8); 
    if (steps !== 0) {
      let newVal = startVal + (steps * step);
      if (newVal < min) newVal = min;
      if (newVal > max) newVal = max;
      let decimals = step.toString().includes('.') ? step.toString().split('.')[1].length : 0;
      input.value = newVal.toFixed(decimals);
      input.classList.remove('auto-filled');
      if (input.oninput) input.oninput();
    }
  };
  
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, {passive: false}); // passive: false で preventDefault 有効化
  
  const onEnd = () => { isDragging = false; };
  window.addEventListener('mouseup', onEnd);
  window.addEventListener('touchend', onEnd);

  // 3. タップでキーボード展開（バリアを一時的に消す）
  overlay.addEventListener('click', (e) => {
    if (!hasMoved) {
      // スワイプせずに純粋に1回タップされた場合
      overlay.style.display = 'none'; // バリア解除
      input.focus(); // 100%確実にキーボードが表示される
    }
  });

  // 4. キーボードが閉じたらバリアを復活
  input.addEventListener('blur', () => {
    overlay.style.display = 'block'; // 再びスワイプ待機状態へ
  });
}


function getNickname() {
  let name = localStorage.getItem('pachinko_nickname');
  if (name && name.trim() !== "") return name.trim();
  if (currentUser && currentUser.email) return currentUser.email.substring(0, 5);
  return "名無し";
}
function updateNickname() {
  const newName = document.getElementById('updateNicknameInput').value.trim();
  if(newName) {
    localStorage.setItem('pachinko_nickname', newName); alert("ニックネームを更新しました！");
    document.getElementById('updateNicknameInput').value = ''; updateModeIndicator();
  } else { alert("ニックネームを入力してください。"); }
}
function saveNicknameFromInput() {
  const name = document.getElementById('nicknameInput').value.trim();
  if (name) localStorage.setItem('pachinko_nickname', name); else localStorage.removeItem('pachinko_nickname');
}
function formatCurrency(num) { return (num > 0 ? "+" : "") + Math.round(num).toLocaleString() + " 円"; }

function updateModeIndicator() {
  const n1 = document.getElementById('nav-tab1'), n2 = document.getElementById('nav-tab2'), n3 = document.getElementById('nav-tab3'), hdSection = document.getElementById('history-and-dict-section');
  if (currentGroupId) {
    n1.style.display = 'block'; n2.style.display = 'block'; n3.style.display = 'block';
    document.getElementById('group-none').style.display = 'none'; document.getElementById('group-active').style.display = 'block';
    document.getElementById('dispGroupId').innerText = currentGroupId;
    document.getElementById('dispUserRole').innerText = isAdmin ? "👑 あなたの権限: 管理者 (更新・削除可能)" : "👤 あなたの権限: メンバー (追加・閲覧のみ)";
    document.getElementById('dispNickname').innerText = getNickname(); hdSection.style.display = 'block';
  } else {
    n1.style.display = 'none'; n2.style.display = 'none'; n3.style.display = 'none';
    document.getElementById('group-none').style.display = 'block'; document.getElementById('group-active').style.display = 'none';
    hdSection.style.display = 'none'; switchTab('tab4');
  }
}

function switchTab(tabId) {
  vibrate(30); 
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.top-nav button').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId).classList.add('active'); document.getElementById('nav-' + tabId).classList.add('active');
  refreshActiveTabUI();
}
function refreshActiveTabUI() {
  const activeTabBtn = document.querySelector('.top-nav button.active'); if(!activeTabBtn) return;
  const tabId = activeTabBtn.id.replace('nav-', '');
  if(tabId === 'tab1') renderSavedRecords();
  if(tabId === 'tab3') renderCalendar();
  if(tabId === 'tab4') { renderDictionary(); renderHistoryTab(); }
}

function attachGroupListener(groupId) {
  if (unsubscribeGroup) unsubscribeGroup();
  if (!db || !groupId) return;
  unsubscribeGroup = db.collection('groups').doc(groupId).onSnapshot(doc => {
    if (doc.exists) {
      globalGroupData = doc.data();
      if(!globalGroupData.records) globalGroupData.records = [];
      if(!globalGroupData.calendar) globalGroupData.calendar = {};
      if(!globalGroupData.dictionary) globalGroupData.dictionary = {};
      isAdmin = (globalGroupData.creator === currentUser.uid);
      updateModeIndicator(); refreshActiveTabUI(); 
    } else {
      currentGroupId = null; isAdmin = false; localStorage.removeItem('pachinko_groupId');
      if(unsubscribeGroup) unsubscribeGroup(); updateModeIndicator();
    }
  }, error => { console.error("Firebase sync error:", error); });
}

async function createGroup() {
  if (!currentUser || !db) return alert("Firebaseにログインしてください。");
  saveNicknameFromInput(); const newId = Math.random().toString(36).substr(2, 6).toUpperCase(); 
  try {
    await db.collection('groups').doc(newId).set({ created: Date.now(), creator: currentUser.uid });
    currentGroupId = newId; localStorage.setItem('pachinko_groupId', newId);
    alert(`グループを作成しました！\nID: ${newId}`);
    attachGroupListener(newId); switchTab('tab1');
  } catch (error) { alert("グループの作成に失敗しました。"); }
}

async function joinGroup() {
  if (!currentUser || !db) return alert("Firebaseにログインしてください。");
  saveNicknameFromInput(); const idInput = document.getElementById('joinGroupId').value.trim().toUpperCase();
  if (idInput.length !== 6) return alert("6桁のグループIDを入力してください。");
  try {
    const doc = await db.collection('groups').doc(idInput).get();
    if (doc.exists) {
      currentGroupId = idInput; localStorage.setItem('pachinko_groupId', idInput);
      document.getElementById('joinGroupId').value = ''; alert("参加しました！");
      attachGroupListener(idInput); switchTab('tab1');
    } else { alert("指定されたIDのグループが見つかりません。"); }
  } catch (error) { alert("グループの参加に失敗しました。"); }
}

function leaveGroup() {
  if(confirm("グループから退出しますか？\n（再度IDを入力すれば戻れます）")) {
    currentGroupId = null; isAdmin = false; localStorage.removeItem('pachinko_groupId');
    if(unsubscribeGroup) unsubscribeGroup(); updateModeIndicator();
  }
}

async function mergePersonalDataToGroup() {
  if (!currentGroupId || !currentUser || !db) return alert("ログインし、グループに参加した状態で実行してください。");
  if (!confirm("あなたの個人の過去データ（履歴・カレンダー・辞書）をすべてグループに合算し共有します。\n※この操作は取り消せません。よろしいですか？")) return;
  try {
    const personalRef = db.collection('users').doc(currentUser.uid); const groupRef = db.collection('groups').doc(currentGroupId);
    const [pDoc, gDoc] = await Promise.all([personalRef.get(), groupRef.get()]);
    const pData = pDoc.exists ? pDoc.data() : {}; const gData = gDoc.exists ? gDoc.data() : {};

    const mergedRecords = [...(gData.records || []), ...(pData.records || [])];
    const uniqueRecordsMap = new Map(); mergedRecords.forEach(r => uniqueRecordsMap.set(r.id, r));
    
    const pCal = pData.calendar || {}, finalCal = { ...(gData.calendar || {}) };
    for (let date in pCal) {
      if (finalCal[date]) {
        finalCal[date].ev = (finalCal[date].ev || 0) + (pCal[date].ev || 0); finalCal[date].actual = (finalCal[date].actual || 0) + (pCal[date].actual || 0);
        finalCal[date].actualBalls = (finalCal[date].actualBalls || 0) + (pCal[date].actualBalls || 0); finalCal[date].details = [...(finalCal[date].details || []), ...(pCal[date].details || [])];
      } else { finalCal[date] = pCal[date]; }
    }
    const finalDict = { ...(gData.dictionary || {}), ...(pData.dictionary || {}) };
    await groupRef.set({ records: Array.from(uniqueRecordsMap.values()), calendar: finalCal, dictionary: finalDict }, { merge: true });
    alert("個人のデータをすべてグループに共有・統合しました！");
  } catch(e) { alert("データの統合に失敗しました。"); }
}

window.onload = function() {
  if (localStorage.getItem('pachinko_theme') === 'dark') document.getElementById('darkModeToggle').checked = true;
  const today = new Date(); currentCalYear = today.getFullYear(); currentCalMonth = today.getMonth();
  const yyyy = today.getFullYear(), mm = String(today.getMonth() + 1).padStart(2, '0'), dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;
  
  document.getElementById('recordDate').value = todayStr; document.getElementById('evSaveDate').value = todayStr; document.getElementById('actualDate').value = todayStr;
  
  setupSwipeInput('startSpin', 10, 0, 10000, 0);
  setupSwipeInput('measuredSpin', 1, 0, 9999, () => {
    const start = parseInt(document.getElementById('startSpin').value) || 0;
    let soFar = 0; historyData.forEach(d => { if (d.type === 'spin' || !d.type) soFar += d.spins; });
    return start + soFar + 15;
  });
  setupSwipeInput('payoutAmount', 10, 0, 100000, 1500); setupSwipeInput('border', 0.1, 10.0, 30.0, 18.0);
  setupSwipeInput('spinRate', 0.1, 10.0, 35.0, 20.0); setupSwipeInput('exchangeRate', 0.01, 2.50, 4.00, 3.57);
  setupSwipeInput('ballRatio', 1, 0, 100, 60); setupSwipeInput('totalSpins', 10, 100, 15000, 2000);
  setupSwipeInput('probDenom', 0.1, 1.0, 499.0, 319.6); setupSwipeInput('avgPayout', 10, 100, 10500, 4500);

  updateModeIndicator();

  if (auth) {
    auth.onAuthStateChanged(user => {
      if (user) {
        currentUser = user; document.getElementById('user-info').innerText = `ログイン中: ${user.email}`; document.getElementById('user-info').style.color = '#27ae60';
        document.getElementById('login-btn').style.display = 'none'; document.getElementById('logout-btn').style.display = 'inline-block';
        if (currentGroupId && db) { attachGroupListener(currentGroupId); } else { updateModeIndicator(); }
      } else {
        currentUser = null; currentGroupId = null; isAdmin = false; if(unsubscribeGroup) unsubscribeGroup();
        document.getElementById('user-info').innerText = 'ログインしていません'; document.getElementById('user-info').style.color = '#e74c3c';
        document.getElementById('login-btn').style.display = 'inline-block'; document.getElementById('logout-btn').style.display = 'none'; updateModeIndicator();
      }
    });
  }
};

function login() {
  if(!auth) return alert("Firebaseの設定が完了していません。");
  const provider = new firebase.auth.GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' });
  auth.signInWithPopup(provider).catch(error => { alert("ログインに失敗しました。"); });
}
function logout() { if(auth) auth.signOut(); }

async function getRecordsData() { return globalGroupData.records || []; }
async function getCalendarData() { return globalGroupData.calendar || {}; }
async function getDictionaryData() { return globalGroupData.dictionary || {}; }

async function saveRecordsData(records) { if (currentGroupId && db) await db.collection('groups').doc(currentGroupId).set({ records: records }, { merge: true }); }
async function saveCalendarData(calendar) { if (currentGroupId && db) await db.collection('groups').doc(currentGroupId).set({ calendar: calendar }, { merge: true }); }
async function saveDictionaryData(dict) { if (currentGroupId && db) await db.collection('groups').doc(currentGroupId).set({ dictionary: dict }, { merge: true }); }

async function renderDictionary() {
  const dict = await getDictionaryData();
  const listEl = document.getElementById('machineList'); let optionsHtml = ''; for(let m in dict) { optionsHtml += `<option value="${m}"></option>`; }
  listEl.innerHTML = optionsHtml;
  const container = document.getElementById('dictContainer'); let html = '';
  for(let m in dict) {
    const spec = dict[m];
    let adminButtons = isAdmin ? `<div style="display:flex; justify-content:flex-end; gap:5px;"><button class="btn-small" style="background:#3498db;" onclick="updateDictItem('${m}')">更新</button><button class="btn-small" style="background:#e74c3c;" onclick="deleteDictItem('${m}')">削除</button></div>` : '';
    html += `<div class="saved-item" style="border-left: 4px solid #1abc9c;"><div style="font-weight:bold; color:var(--text-main); margin-bottom:8px;">${m}</div><div style="display:flex; gap:5px; margin-bottom:5px;"><div style="flex:1"><label style="font-size:11px; margin-bottom:2px;">ボーダー</label><input type="number" id="dict_border_${m}" value="${spec.border || ''}" step="0.1" style="padding:6px; font-size:14px;" ${!isAdmin?'disabled':''}></div><div style="flex:1"><label style="font-size:11px; margin-bottom:2px;">確率</label><input type="number" id="dict_prob_${m}" value="${spec.probDenom || ''}" step="0.1" style="padding:6px; font-size:14px;" ${!isAdmin?'disabled':''}></div><div style="flex:1"><label style="font-size:11px; margin-bottom:2px;">出玉</label><input type="number" id="dict_payout_${m}" value="${spec.avgPayout || ''}" step="10" style="padding:6px; font-size:14px;" ${!isAdmin?'disabled':''}></div></div>${adminButtons}</div>`;
  }
  if(html === '') html = '<p style="font-size:13px; color:var(--text-muted);">登録されている機種スペックはありません。</p>';
  container.innerHTML = html; 
}

window.updateDictItem = async function(machine) {
  if (!isAdmin) return alert("権限がありません。");
  const b = parseFloat(document.getElementById(`dict_border_${machine}`).value), p = parseFloat(document.getElementById(`dict_prob_${machine}`).value), a = parseFloat(document.getElementById(`dict_payout_${machine}`).value);
  const dict = await getDictionaryData(); if(!dict[machine]) dict[machine] = {};
  if(!isNaN(b)) dict[machine].border = b; if(!isNaN(p)) dict[machine].probDenom = p; if(!isNaN(a)) dict[machine].avgPayout = a;
  await saveDictionaryData(dict); alert(`[${machine}] の辞書を更新しました。`);
};
window.deleteDictItem = async function(machine) {
  if (!isAdmin) return alert("権限がありません。");
  if(confirm(`[${machine}] を辞書から削除しますか？`)) { const dict = await getDictionaryData(); delete dict[machine]; await saveDictionaryData(dict); }
};

function createRecordItemHtml(r) {
  let historyHtml = '';
  if (r.history && r.history.length > 0) {
    historyHtml = `<details style="margin-top: 8px;"><summary style="cursor: pointer; font-size: 13px; font-weight: bold; color: #2980b9;">計測履歴を表示</summary><div class="saved-history-box">`;
    let spinCount = 0;
    r.history.forEach((h) => { 
      if (h.type === 'spin' || !h.type) {
        spinCount++;
        let cvt = h.balls === 125 ? `<span style="font-size: 11px; color: var(--text-muted); margin-left: 6px;">(250玉換算: ${h.spins * 2}回)</span>` : "";
        let typeLabel = h.isMochidama ? `<span style="color:#e67e22; font-size:11px; margin-left:4px;">[持球]</span>` : `<span style="color:#27ae60; font-size:11px; margin-left:4px;">[現金]</span>`;
        let hitLabel = h.hitType ? `<span style="color:#d35400; font-size:11px; margin-left:4px; font-weight:bold;">[${h.hitType}]</span>` : "";
        historyHtml += `<div style="margin-bottom: 4px; border-bottom: 1px dashed var(--border-color); padding-bottom: 2px;">${spinCount}回目: ${h.balls}玉 で <strong>${h.spins}回</strong>${typeLabel}${hitLabel}${cvt}</div>`; 
      } else if (h.type === 'payout') {
        let memoHtml = h.memo ? `<span style="font-size:11px; color: var(--text-muted); margin-left:6px;">(${h.memo})</span>` : "";
        historyHtml += `<div style="margin-bottom: 4px; background-color:var(--box-yellow-bg); padding: 2px 4px; border-radius:2px; font-size:11px;"><span style="color:#d35400; font-weight:bold;">🎉 ${h.hitType}獲得: ${h.amount}玉${memoHtml}</span></div>`;
      }
    });
    historyHtml += `</div></details>`;
  }
  let dispRatio = (r.mochidamaRatio || 0).toFixed(1), startDisp = (r.startSpins !== undefined && r.startSpins >= 0) ? ` <span style="color:var(--text-muted); font-size:11px;">(開始${r.startSpins}G → 終了${r.startSpins + r.totalSpins}G)</span>` : '';
  let storeDisp = r.store ? `<span style="color:var(--text-muted); font-size:12px; margin-right:6px;">[${r.store}]</span>` : '', authorDisp = r.author ? `<span class="author-badge">👤 ${r.author}</span>` : '';
  const safeStr = encodeURIComponent(JSON.stringify(r.hitHistory || [])), safeHist = encodeURIComponent(JSON.stringify(r.history || []));
  const btnCall = `useRecordForCalc('${r.date}', ${r.avg250}, '${r.machine}', ${r.mochidamaRatio || 0}, '${r.store || ''}', ${r.totalCashBalls || 0}, ${r.totalMochiBalls || 0}, ${r.totalPayout || 0}, '${safeStr}', '${safeHist}')`;
  let resumeButton = `<button class="btn-small" style="background:#f39c12;" onclick="resumeRecord(${r.id})">続きを計測</button>`;
  let adminButtons = isAdmin ? `<button class="btn-small" style="background:#95a5a6;" onclick="deleteRecord(${r.id})">削除</button>` : '';

  return `<div class="saved-item"><div style="font-weight:bold; color:var(--text-main); font-size: 15px;">${r.date} ｜ ${storeDisp}${r.machine}${authorDisp}</div><div style="font-size:13px; margin:6px 0; color:var(--text-sub);">総投資: ${r.totalBalls}玉 / 自力回転: ${r.totalSpins}回${startDisp}<br><span style="color:#e74c3c; font-weight:bold; font-size:14px;">250玉平均: ${r.avg250.toFixed(2)} 回</span><span style="color:#e67e22; font-weight:bold; font-size:13px; margin-left:10px;">持球比率: ${dispRatio}%</span></div>${historyHtml}<div style="margin-top: 10px; display: flex; gap: 4px; flex-wrap: wrap;">${resumeButton}<button class="btn-small" style="background:#3498db;" onclick="${btnCall}">期待値を計算</button>${adminButtons}</div></div>`;
}

window.addMeasurement = function(balls) {
  vibrate();
  const spinInput = document.getElementById('measuredSpin'), currentMachineSpin = parseFloat(spinInput.value);
  if (isNaN(currentMachineSpin) || currentMachineSpin < 0) return alert("現在のデータ機回転数を正しく入力してください。");
  const startSpin = parseInt(document.getElementById('startSpin').value) || 0;
  let totalSpinsSoFar = 0; historyData.forEach(d => { if (d.type === 'spin' || !d.type) totalSpinsSoFar += d.spins; });
  const lastSpin = startSpin + totalSpinsSoFar, spins = currentMachineSpin - lastSpin;
  if (spins <= 0) return alert(`現在の回転数は、前回の回転数 (${lastSpin}回) より大きい数値を入力してください。`);
  
  const isMochi = document.getElementById('isMochidama').checked, hitType = document.getElementById('hitNormal').checked ? '通常' : (document.getElementById('hitRush').checked ? 'ラッシュ' : null);
  historyData.push({ type: 'spin', balls: balls, spins: spins, isMochidama: isMochi, hitType: hitType });
  spinInput.value = ''; 
  if (!measurementStartTime) measurementStartTime = Date.now(); 
  
  if (hitType) {
    document.getElementById('payoutTitle').innerText = `${hitType}当たり 獲得出玉を入力`;
    document.getElementById('payoutAmount').value = ''; document.getElementById('payoutMemo').value = '';
    document.getElementById('payoutInputArea').style.display = 'block';
  } else { document.getElementById('payoutInputArea').style.display = 'none'; }
  updateMeasurementDisplay();
};

window.addPayout = function() {
  vibrate();
  const amountInput = document.getElementById('payoutAmount'), amount = parseFloat(amountInput.value);
  if (isNaN(amount) || amount < 0) return alert("正しい出玉を入力してください。");
  const hitType = document.getElementById('hitNormal').checked ? '通常' : (document.getElementById('hitRush').checked ? 'ラッシュ' : '不明');
  historyData.push({ type: 'payout', amount: amount, hitType: hitType, memo: document.getElementById('payoutMemo').value.trim() });
  
  document.getElementById('hitNormal').checked = false; document.getElementById('hitRush').checked = false;
  amountInput.value = ''; document.getElementById('payoutMemo').value = ''; document.getElementById('payoutInputArea').style.display = 'none';
  if (!measurementStartTime) measurementStartTime = Date.now(); 
  updateMeasurementDisplay();
};

window.undoLastInput = function() {
  if (historyData.length === 0) return alert("取り消す入力がありません。");
  if (!confirm("直前の入力を取り消しますか？\n※この操作は元に戻せません。")) return;
  vibrate(40); historyData.pop(); if (historyData.length === 0) measurementStartTime = null; 
  updateMeasurementDisplay();
};

window.deleteHistoryItem = function(index) { historyData.splice(index, 1); updateMeasurementDisplay(); };

function updateMeasurementDisplay() {
  const btnModal = document.getElementById('btnOpenResultModal');
  if (historyData.length === 0) { 
    btnModal.innerText = "📊 入力データを確認 (未入力)"; document.getElementById('avg250').innerText = "0.00 回"; document.getElementById('historyList').innerHTML = ""; return; 
  }
  
  let totalBalls = 0, totalSpins = 0, mochidamaBalls = 0, historyHtml = '', spinCount = 0;
  for (let i = 0; i < historyData.length; i++) {
    let item = historyData[i]; let itemHtml = '';
    if (item.type === 'spin' || !item.type) {
      spinCount++; totalBalls += item.balls; totalSpins += item.spins; if (item.isMochidama) mochidamaBalls += item.balls;
      let cvt = item.balls === 125 ? `<span style="font-size:11px; color:var(--text-muted); margin-left:6px;">(250玉換算: ${item.spins * 2}回)</span>` : "";
      let typeLabel = item.isMochidama ? `<span style="color:#e67e22; font-size:11px; margin-left:4px;">[持球]</span>` : `<span style="color:#27ae60; font-size:11px; margin-left:4px;">[現金]</span>`;
      let hitLabel = item.hitType ? `<span style="color:#d35400; font-size:11px; margin-left:4px; font-weight:bold;">[${item.hitType}当たり!]</span>` : "";
      itemHtml = `<div class="history-item"><span>${spinCount}回目: ${item.balls}玉で <strong>${item.spins}回</strong>${typeLabel}${hitLabel}${cvt}</span><button class="btn-delete-item" onclick="deleteHistoryItem(${i})">× 削除</button></div>`;
    } else if (item.type === 'payout') {
      let memoHtml = item.memo ? `<span style="font-size:11px; color:var(--text-muted); margin-left:6px;">(${item.memo})</span>` : "";
      itemHtml = `<div class="history-item" style="background-color:var(--box-yellow-bg); padding:4px 8px; border-radius:4px; margin-top:2px; margin-bottom:2px;"><span style="color:#d35400; font-weight:bold; font-size:13px;">🎉 ${item.hitType}獲得: ${item.amount}玉${memoHtml}</span><button class="btn-delete-item" onclick="deleteHistoryItem(${i})">× 削除</button></div>`;
    }
    historyHtml = itemHtml + historyHtml; 
  }
  historyHtml = '<strong>入力履歴:</strong><br>' + historyHtml;
  
  const avg250 = totalBalls > 0 ? (totalSpins / totalBalls) * 250 : 0;
  const mochiRatio = totalBalls > 0 ? (mochidamaBalls / totalBalls * 100) : 0;
  const startSpin = parseInt(document.getElementById('startSpin').value) || 0, absoluteTotalSpins = startSpin + totalSpins;
  
  document.getElementById('avg250').innerText = avg250.toFixed(2) + " 回"; document.getElementById('dispMochiRatio').innerText = mochiRatio.toFixed(1) + " %";
  document.getElementById('totalMeasuredSpins').innerText = totalSpins + " 回"; document.getElementById('absoluteTotalSpins').innerText = absoluteTotalSpins + " 回";
  document.getElementById('totalMeasuredBalls').innerText = totalBalls + " 玉"; document.getElementById('historyList').innerHTML = historyHtml;
  
  let speedHtml = "";
  if (measurementStartTime && totalSpins > 0) {
    const elapsedMinutes = (Date.now() - measurementStartTime) / 60000;
    if (elapsedMinutes > 3) { speedHtml = ` / 時速:${Math.round(totalSpins / (elapsedMinutes / 60))}回`; }
  }
  btnModal.innerText = `📊 データ確認 (投資:${totalBalls}玉 / 平均:${avg250.toFixed(1)}回${speedHtml})`;

  if (editingRecordId) { document.getElementById('btnSaveRecord').innerText = "この記録を上書き保存"; document.getElementById('btnSaveRecord').style.backgroundColor = "#d35400"; } 
  else { document.getElementById('btnSaveRecord').innerText = "この記録を保存"; document.getElementById('btnSaveRecord').style.backgroundColor = "#e67e22"; }
}

window.resetMeasurement = function() {
  if(confirm("現在の入力データをすべてクリアしますか？")) { 
    historyData = []; editingRecordId = null; measurementStartTime = null;
    document.getElementById('startSpin').value = ''; document.getElementById('hitNormal').checked = false; document.getElementById('hitRush').checked = false;
    document.getElementById('payoutAmount').value = ''; document.getElementById('payoutMemo').value = ''; document.getElementById('payoutInputArea').style.display = 'none';
    updateMeasurementDisplay(); closeResultModal();
  }
};

window.saveCurrentRecord = async function() {
  vibrate(50); 
  const date = document.getElementById('recordDate').value, store = document.getElementById('storeName').value.trim(), machine = document.getElementById('machineName').value.trim();
  if (!date || !machine) return alert("日付と機種名を入力してください。");
  if (historyData.length === 0) return alert("回転数の履歴がありません。");
  
  let totalBalls = 0, totalSpins = 0, mochidamaBalls = 0, cashBalls = 0, totalPayout = 0, hitHistory = [];
  historyData.forEach(d => { 
    if (d.type === 'spin' || !d.type) { totalBalls += d.balls; totalSpins += d.spins; if(d.isMochidama) mochidamaBalls += d.balls; else cashBalls += d.balls; } 
    else if (d.type === 'payout') { totalPayout += d.amount; hitHistory.push(d); }
  });
  
  const startSpin = parseInt(document.getElementById('startSpin').value) || 0, avg250 = (totalSpins / totalBalls) * 250, mochiRatio = totalBalls > 0 ? (mochidamaBalls / totalBalls * 100) : 0;
  
  if (isAdmin) {
    const dict = await getDictionaryData();
    if (!dict[machine]) { dict[machine] = { border: "", probDenom: "", avgPayout: "" }; await saveDictionaryData(dict); }
  }
  
  const records = await getRecordsData();
  const newRecord = { 
    id: editingRecordId ? editingRecordId : Date.now(), 
    date: date, store: store, machine: machine, author: getNickname(), 
    totalBalls: totalBalls, totalSpins: totalSpins, startSpins: startSpin,
    totalCashBalls: cashBalls, totalMochiBalls: mochidamaBalls, totalPayout: totalPayout,
    avg250: avg250, mochidamaRatio: mochiRatio, history: [...historyData], hitHistory: hitHistory
  };
  
  if (editingRecordId) {
    const idx = records.findIndex(rec => rec.id === editingRecordId);
    if(idx !== -1) records[idx] = newRecord; else records.push(newRecord);
    editingRecordId = null; 
  } else { records.push(newRecord); }
  
  await saveRecordsData(records); alert(`${machine} のデータを保存しました。`);
  
  historyData = []; measurementStartTime = null;
  document.getElementById('machineName').value = ''; document.getElementById('startSpin').value = '';
  document.getElementById('hitNormal').checked = false; document.getElementById('hitRush').checked = false;
  document.getElementById('payoutAmount').value = ''; document.getElementById('payoutMemo').value = '';
  document.getElementById('payoutInputArea').style.display = 'none';
  
  updateMeasurementDisplay(); closeResultModal(); 
};

window.resumeRecord = async function(id) {
  if(!confirm("このデータの続きを計測しますか？\n※現在入力中のデータがある場合、破棄されて上書きされます。")) return;
  const records = await getRecordsData(); const r = records.find(rec => rec.id === id); if(!r) return;
  
  document.getElementById('recordDate').value = r.date || ''; document.getElementById('storeName').value = r.store || '';
  document.getElementById('machineName').value = r.machine || ''; document.getElementById('startSpin').value = r.startSpins || 0;
  historyData = JSON.parse(JSON.stringify(r.history || [])); editingRecordId = r.id; measurementStartTime = Date.now(); 
  document.getElementById('hitNormal').checked = false; document.getElementById('hitRush').checked = false;
  document.getElementById('payoutAmount').value = ''; document.getElementById('payoutMemo').value = ''; document.getElementById('payoutInputArea').style.display = 'none';
  updateMeasurementDisplay(); closeSavedModal(); window.scrollTo({ top: 0, behavior: 'smooth' });
};

async function renderSavedRecords() {
  const records = await getRecordsData(), container = document.getElementById('savedRecordsContainer'), targetDate = document.getElementById('recordDate').value;
  if (!targetDate) return container.innerHTML = '<p style="font-size:13px; color:var(--text-muted);">日付を選択してください。</p>';
  const filtered = records.filter(r => r.date === targetDate);
  if (filtered.length === 0) return container.innerHTML = '<p style="font-size:13px; color:var(--text-muted);">この日付に保存されたデータはありません。</p>';
  filtered.sort((a, b) => new Date(b.date) - new Date(a.date)); let html = ''; filtered.forEach(r => { html += createRecordItemHtml(r); }); container.innerHTML = html;
}

window.deleteRecord = async function(id) {
  if (!isAdmin) return alert("権限がありません。");
  if(confirm("このデータを削除しますか？")) { let records = await getRecordsData(); await saveRecordsData(records.filter(r => r.id !== id)); }
};

window.loadMachineSpec = async function() {
  const machine = document.getElementById('calcMachineName').value.trim(); document.getElementById('evSaveMachine').value = machine; 
  if(!machine) return;
  const dict = await getDictionaryData();
  if(dict[machine]) {
    const spec = dict[machine];
    if(spec.border) { document.getElementById('border').value = spec.border; document.getElementById('border').classList.add('auto-filled'); }
    if(spec.probDenom) { document.getElementById('probDenom').value = spec.probDenom; document.getElementById('probDenom').classList.add('auto-filled'); }
    if(spec.avgPayout) { document.getElementById('avgPayout').value = spec.avgPayout; document.getElementById('avgPayout').classList.add('auto-filled'); }
  }
};

window.useRecordForCalc = async function(recordDate, avg, machineName, mochidamaRatio, storeName, cashBalls, mochiBalls, payout, hitHistoryStr, historyStr) {
  currentPassData = {
    cashBalls: cashBalls || 0, mochiBalls: mochiBalls || 0, payout: payout || 0,
    hitHistory: hitHistoryStr ? JSON.parse(decodeURIComponent(hitHistoryStr)) : [], history: historyStr ? JSON.parse(decodeURIComponent(historyStr)) : []
  };
  document.getElementById('calcMachineName').value = machineName || ""; await window.loadMachineSpec(); 
  document.getElementById('spinRate').value = avg.toFixed(2); document.getElementById('spinRate').classList.add('auto-filled');
  if (mochidamaRatio !== undefined) { document.getElementById('ballRatio').value = Math.round(mochidamaRatio); document.getElementById('ballRatio').classList.add('auto-filled'); }
  if (recordDate) document.getElementById('evSaveDate').value = recordDate;
  document.getElementById('evSaveStore').value = storeName || ""; 
  closeSavedModal(); switchTab('tab2');
};

function drawSlumpGraph() {
  const ctx = document.getElementById('slumpGraph'); if (!ctx) return;
  let targetHistory = historyData.length > 0 ? historyData : (currentPassData ? currentPassData.history : []);
  if (!targetHistory || targetHistory.length === 0) return document.getElementById('graphContainer').style.display = 'none';
  document.getElementById('graphContainer').style.display = 'block';

  let chartData = [{ x: 0, y: 0 }]; let currentInvest = 0, currentPayout = 0;
  targetHistory.forEach(item => {
    if (item.type === 'spin' || !item.type) currentInvest += item.balls; else if (item.type === 'payout') currentPayout += item.amount;
    chartData.push({ x: currentInvest, y: currentPayout - currentInvest });
  });

  if (slumpChartInstance) slumpChartInstance.destroy();
  slumpChartInstance = new Chart(ctx, {
    type: 'line', data: { datasets: [{ label: '差玉 (玉)', data: chartData, borderColor: '#3498db', backgroundColor: 'rgba(52, 152, 219, 0.1)', borderWidth: 2, pointRadius: 2, pointBackgroundColor: '#e67e22', fill: true, stepped: false }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { type: 'linear', title: { display: true, text: '累積投資玉数 (玉)', font: {size: 11} }, min: 0 }, y: { title: { display: true, text: '差玉 (玉)', font: {size: 11} } } }, plugins: { legend: { display: false } } }
  });
}

// 🚀 フリーズしない 10万回 Web Worker シミュレーション
window.calculateAndSimulate = function() {
  vibrate(); 
  const inputs = [
    { id: 'border', name: '等価ボーダー' }, { id: 'spinRate', name: '現在の平均回転数' },
    { id: 'exchangeRate', name: '交換率' }, { id: 'ballRatio', name: '持ち球比率' },
    { id: 'totalSpins', name: '総回転数' }, { id: 'probDenom', name: '大当たり確率' },
    { id: 'avgPayout', name: '初当たり平均獲得出玉' }
  ];
  let missing = []; inputs.forEach(item => { if (!document.getElementById(item.id).value) missing.push(item.name); });
  if (missing.length > 0) return alert("以下の項目が未入力です：\n・" + missing.join("\n・"));

  const B = parseFloat(document.getElementById('border').value), R = parseFloat(document.getElementById('spinRate').value);
  const E = parseFloat(document.getElementById('exchangeRate').value), M = parseFloat(document.getElementById('ballRatio').value) / 100;
  const totalSpins = parseFloat(document.getElementById('totalSpins').value), probDenom = parseFloat(document.getElementById('probDenom').value), avgPayout = parseFloat(document.getElementById('avgPayout').value);

  const calcMachine = document.getElementById('calcMachineName').value.trim();
  if(calcMachine && isAdmin) {
    getDictionaryData().then(dict => {
      if(!dict[calcMachine]) dict[calcMachine] = {};
      dict[calcMachine].border = B; dict[calcMachine].probDenom = probDenom; dict[calcMachine].avgPayout = avgPayout;
      saveDictionaryData(dict); 
    });
  }

  const btn = document.querySelector('button[onclick="calculateAndSimulate()"]');
  if(btn) btn.innerText = "🚀 10万回シミュレート中...";

  const worker = new Worker('./worker.js');
  worker.postMessage({ B, R, E, M, totalSpins, probDenom, avgPayout });
  
  worker.onmessage = function(e) {
    if(btn) btn.innerText = "期待値を計算＆シミュレート";
    const data = e.data;
    lastCalculatedEV = data.totalEV; 
    document.getElementById('resSpin').innerText = data.evSpin.toFixed(2) + " 円"; document.getElementById('resTotal').innerText = formatCurrency(Math.ceil(lastCalculatedEV));
    document.getElementById('resultArea').style.display = 'block';

    document.getElementById('simBot5').innerText = formatCurrency(data.simBot5); document.getElementById('simBot25').innerText = formatCurrency(data.simBot25);
    document.getElementById('simMedian').innerText = formatCurrency(data.simMedian); document.getElementById('simTop25').innerText = formatCurrency(data.simTop25); document.getElementById('simTop5').innerText = formatCurrency(data.simTop5);
    
    document.getElementById('simArea').style.display = 'block'; drawSlumpGraph(); worker.terminate();
  };
};

window.saveExpectedValueToCalendar = async function() {
  vibrate(50); 
  const date = document.getElementById('evSaveDate').value, store = document.getElementById('evSaveStore').value || "店舗不明", machine = document.getElementById('evSaveMachine').value || "機種不明";
  if(!date) return alert("日付を入力してください");
  if(lastCalculatedEV === 0) return alert("期待値が計算されていません。");
  const exchangeRate = parseFloat(document.getElementById('exchangeRate').value); if(isNaN(exchangeRate)) return alert("交換率が入力されていません。");

  let actualAmt = 0, diffBalls = 0, hitText = "";
  if (currentPassData) {
      const cashInvest = currentPassData.cashBalls, mochiInvest = currentPassData.mochiBalls, payout = currentPassData.payout;
      diffBalls = payout - (cashInvest + mochiInvest); actualAmt = (payout - mochiInvest) * exchangeRate - (cashInvest * 4);
      if(currentPassData.hitHistory && currentPassData.hitHistory.length > 0){
          currentPassData.hitHistory.forEach(h => { let memo = h.memo ? ` (${h.memo})` : ''; hitText += `<br><span style="color:var(--text-muted); font-size:12px;"> └ ${h.hitType}: ${h.amount}玉${memo}</span>`; });
      }
  }

  const cal = await getCalendarData();
  if(!cal[date]) cal[date] = { ev: 0, actual: 0, actualBalls: 0, details: [] };
  
  cal[date].ev = (cal[date].ev || 0) + lastCalculatedEV; cal[date].actual = (cal[date].actual || 0) + actualAmt; cal[date].actualBalls = (cal[date].actualBalls || 0) + diffBalls;
  cal[date].details.push(`[${store}] ${machine} (期待値: ${formatCurrency(Math.ceil(lastCalculatedEV))} / 実収支: ${formatCurrency(actualAmt)}) <span style="font-size:11px; color:var(--text-muted);">👤 ${getNickname()}</span>${hitText}`);
  await saveCalendarData(cal); alert(`${date} の収支にデータを保存しました。`); renderCalendar();

  document.getElementById('calcMachineName').value = ''; document.getElementById('border').value = ''; document.getElementById('spinRate').value = ''; document.getElementById('exchangeRate').value = '';
  document.getElementById('ballRatio').value = ''; document.getElementById('totalSpins').value = ''; document.getElementById('probDenom').value = ''; document.getElementById('avgPayout').value = '';
  document.getElementById('evSaveStore').value = ''; document.getElementById('evSaveMachine').value = '';
  const today = new Date(), yyyy = today.getFullYear(), mm = String(today.getMonth() + 1).padStart(2, '0'), dd = String(today.getDate()).padStart(2, '0');
  document.getElementById('evSaveDate').value = `${yyyy}-${mm}-${dd}`;
  document.getElementById('resultArea').style.display = 'none'; document.getElementById('simArea').style.display = 'none';
  if(document.getElementById('graphContainer')) document.getElementById('graphContainer').style.display = 'none';
  ['border', 'spinRate', 'ballRatio', 'probDenom', 'avgPayout'].forEach(id => { const el = document.getElementById(id); if(el) el.classList.remove('auto-filled'); });
  lastCalculatedEV = 0; currentPassData = null;
};

// ==========================================
// ツール③：カレンダー機能
// ==========================================
window.changeMonth = function(diff) { currentCalMonth += diff; if(currentCalMonth < 0) { currentCalMonth = 11; currentCalYear--; } if(currentCalMonth > 11) { currentCalMonth = 0; currentCalYear++; } renderCalendar(); };
window.selectDate = function(dateStr) { document.getElementById('actualDate').value = dateStr; renderCalendar(); };

async function renderCalendar() {
  const cal = await getCalendarData(); const year = currentCalYear, month = currentCalMonth;
  document.getElementById('calendarMonthLabel').innerText = `${year}年 ${month + 1}月`;
  const firstDay = new Date(year, month, 1).getDay(), daysInMonth = new Date(year, month + 1, 0).getDate();
  let html = `<div class="calendar-day-header" style="color:#e74c3c;">日</div><div class="calendar-day-header">月</div><div class="calendar-day-header">火</div><div class="calendar-day-header">水</div><div class="calendar-day-header">木</div><div class="calendar-day-header">金</div><div class="calendar-day-header" style="color:#2980b9;">土</div>`;
  for(let i=0; i<firstDay; i++){ html += `<div class="calendar-cell other-month"></div>`; }
  
  let monthlyEV = 0, monthlyActual = 0, monthlyBalls = 0;
  const monthStr = `${year}-${String(month+1).padStart(2,'0')}`; const selectedDateVal = document.getElementById('actualDate').value;

  for(let day=1; day<=daysInMonth; day++){
    const dateStr = `${monthStr}-${String(day).padStart(2,'0')}`, dayData = cal[dateStr], currentDayOfWeek = (firstDay + day - 1) % 7;
    let dateColor = currentDayOfWeek === 0 ? '#e74c3c' : (currentDayOfWeek === 6 ? '#2980b9' : 'var(--text-main)');
    let cellContent = `<div class="cal-date" style="color:${dateColor};">${day}</div>`;
    
    if(dayData) {
      const ceiledEV = Math.ceil(dayData.ev || 0), actualVal = dayData.actual || 0, actualBallsVal = dayData.actualBalls || 0;
      monthlyEV += ceiledEV; monthlyActual += actualVal; monthlyBalls += actualBallsVal;
      if(dayData.ev) cellContent += `<div class="cal-val ev">期:${ceiledEV.toLocaleString()}</div>`;
      if(dayData.actual) { const aClass = actualVal >= 0 ? 'plus' : 'minus'; cellContent += `<div class="cal-val ${aClass}">実:${actualVal.toLocaleString()}</div>`; }
    }
    const activeClass = (selectedDateVal === dateStr) ? 'active-day' : ''; html += `<div class="calendar-cell ${activeClass}" onclick="selectDate('${dateStr}')">${cellContent}</div>`;
  }
  const remainingCells = (7 - ((firstDay + daysInMonth) % 7)) % 7; for(let i=0; i<remainingCells; i++) { html += `<div class="calendar-cell other-month"></div>`; }
  
  document.getElementById('visualCalendar').innerHTML = html;
  document.getElementById('monthlyEV').innerText = formatCurrency(monthlyEV); document.getElementById('monthlyActual').innerText = formatCurrency(monthlyActual); document.getElementById('monthlyBalls').innerText = monthlyBalls > 0 ? "+" + monthlyBalls.toLocaleString() + " 玉" : monthlyBalls.toLocaleString() + " 玉";
  const mDiff = monthlyActual - monthlyEV, mDiffEl = document.getElementById('monthlyDiff'); mDiffEl.innerText = formatCurrency(mDiff); mDiffEl.className = mDiff > 0 ? 'plus' : (mDiff < 0 ? 'minus' : '');

  document.getElementById('selectedDateDisp').innerText = selectedDateVal || '未選択'; const dayData = cal[selectedDateVal];
  if (dayData) {
    const ceiledEV = Math.ceil(dayData.ev || 0), actualVal = dayData.actual || 0, actualBallsVal = dayData.actualBalls || 0, diff = actualVal - ceiledEV, diffColor = diff > 0 ? 'plus' : (diff < 0 ? 'minus' : '');
    let adminBtn = isAdmin ? `<button class="btn-small" style="background:#e74c3c; margin-top:10px;" onclick="deleteCalendarDay('${selectedDateVal}')">この日の記録を全削除</button>` : '';
    document.getElementById('calendarList').innerHTML = `
    <div class="saved-item" style="border-left: 4px solid #9b59b6;"><div style="font-weight:bold; color:var(--text-main);">${selectedDateVal}</div><div style="font-size: 13px; margin: 6px 0; display: flex; justify-content: space-between;"><span>期待値: <span style="color:#27ae60; font-weight:bold;">${formatCurrency(ceiledEV)}</span></span><span>実収支: <span style="color:#2980b9; font-weight:bold;">${formatCurrency(actualVal)}</span></span></div><div style="font-size: 13px; margin-bottom: 6px; display: flex; justify-content: space-between;"><span>獲得差玉: <span style="color:#e67e22; font-weight:bold;">${actualBallsVal > 0 ? '+' : ''}${actualBallsVal.toLocaleString()} 玉</span></span><span>ブレ: <span class="${diffColor}">${formatCurrency(diff)}</span></span></div><div style="font-size: 13px; color: var(--text-sub); background: var(--bg-main); padding: 6px; border-radius: 4px; line-height: 1.4;">${dayData.details && dayData.details.length > 0 ? dayData.details.join('<br><hr style="margin:6px 0; border-top:1px dashed var(--border-color);">') : '稼働記録なし'}</div>${adminBtn}</div>`;
  } else { document.getElementById('calendarList').innerHTML = '<p style="font-size:13px; color:var(--text-muted);">選択した日付のデータはありません。</p>'; }
}

window.deleteCalendarDay = async function(date) {
  if (!isAdmin) return alert("権限がありません。");
  if(confirm(`${date} の記録をすべて削除しますか？`)) { const cal = await getCalendarData(); delete cal[date]; await saveCalendarData(cal); }
};

window.renderHistoryTab = async function() {
  const records = await getRecordsData(), container = document.getElementById('historyRecordsContainer'), filterText = document.getElementById('historyMachineFilter').value.trim();
  const today = new Date(), oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  let filtered = records.filter(r => { if (!r.date) return false; if (new Date(r.date) < oneYearAgo) return false; if (filterText && r.machine && !r.machine.includes(filterText)) return false; return true; });
  if (filtered.length === 0) return container.innerHTML = '<p style="font-size:13px; color:var(--text-muted);">条件に一致する過去1年間のデータはありません。</p>';
  filtered.sort((a, b) => new Date(b.date) - new Date(a.date)); let html = ''; filtered.forEach(r => { html += createRecordItemHtml(r); }); container.innerHTML = html;
};
