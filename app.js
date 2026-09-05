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
  firebase.firestore().enablePersistence().catch((err) => { console.log("Offline persistence error: ", err.code); });
}

const auth = firebase.apps.length ? firebase.auth() : null;
const db = firebase.apps.length ? firebase.firestore() : null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(err => { console.log('SW registration failed: ', err); }); });
}

let currentUser = null; let currentGroupId = localStorage.getItem('pachinko_groupId') || null; let isAdmin = false; 
let lastCalculatedEV = 0; let historyData = []; let currentPassData = null; let editingRecordId = null; let slumpChartInstance = null; 
let currentCalYear = new Date().getFullYear(); let currentCalMonth = new Date().getMonth();
let unsubscribeGroup = null; let globalGroupData = { records: [], calendar: {}, dictionary: {}, halls: {} };
let measurementStartTime = null; let editingHistoryIndex = null; 

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
function closeResultModal() { document.getElementById('resultModal').style.display = 'none'; editingHistoryIndex = null; updateMeasurementDisplay(); }
function openSavedModal() { renderSavedRecords(); document.getElementById('savedModal').style.display = 'flex'; }
function closeSavedModal() { document.getElementById('savedModal').style.display = 'none'; }

function openAvgRCalcModal() { 
  vibrate(); document.getElementById('avgRCalcModal').style.display = 'flex'; 
  const p = document.getElementById('probDenom').value; const pr = document.getElementById('payoutPerR').value;
  if(p) document.getElementById('calc_b_prob').value = p;
  if(pr) { document.getElementById('calc_b_payout').value = pr; document.getElementById('calc_p_payout').value = pr; }
  window.doAvgRCalc1(); window.doAvgRCalc2();
}
function closeAvgRCalcModal() { document.getElementById('avgRCalcModal').style.display = 'none'; }

const resultModal = document.getElementById('resultModal'); const savedModal = document.getElementById('savedModal'); const avgRCalcModal = document.getElementById('avgRCalcModal');
if(resultModal) resultModal.addEventListener('click', function(e) { if (e.target === resultModal) closeResultModal(); });
if(savedModal) savedModal.addEventListener('click', function(e) { if (e.target === savedModal) closeSavedModal(); });
if(avgRCalcModal) avgRCalcModal.addEventListener('click', function(e) { if (e.target === avgRCalcModal) closeAvgRCalcModal(); });

// ランキングタブ切り替え
window.switchRankTab = function(num) {
  document.querySelectorAll('.rank-tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.rank-content').forEach(el => el.classList.remove('active'));
  document.getElementById(`btn-rank-${num}`).classList.add('active');
  document.getElementById(`rank-content-${num}`).classList.add('active');
};

function setupSwipeInput(id, step, min, max, defaultVal) {
  const input = document.getElementById(id); 
  if (!input || input.hasAttribute('data-swipe-init')) return;
  input.setAttribute('data-swipe-init', 'true');
  let isDragging = false; let startX = 0; let startVal = 0; 
  
  const onStart = (e) => {
    if (input.disabled || input.readOnly) return;
    isDragging = true; startX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    let def = typeof defaultVal === 'function' ? defaultVal() : defaultVal;
    if (input.value === "") {
      let decimals = step.toString().includes('.') ? step.toString().split('.')[1].length : 0;
      input.value = Number(def).toFixed(decimals); input.classList.remove('auto-filled'); if (input.oninput) input.oninput();
    }
    startVal = parseFloat(input.value); if (isNaN(startVal)) startVal = def;
  };
  
  input.addEventListener('mousedown', onStart); input.addEventListener('touchstart', onStart, {passive: true});
  
  const onMove = (e) => {
    if (!isDragging || input.disabled || input.readOnly) return; 
    let clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    let deltaX = clientX - startX; 
    if (Math.abs(deltaX) > 5) {
      if (e.cancelable) e.preventDefault(); 
      if (document.activeElement === input) input.blur(); 
    }
    let steps = Math.trunc(deltaX / 8); 
    if (steps !== 0) {
      let newVal = startVal + (steps * step);
      if (newVal < min) newVal = min; if (newVal > max) newVal = max;
      let decimals = step.toString().includes('.') ? step.toString().split('.')[1].length : 0;
      input.value = newVal.toFixed(decimals); input.classList.remove('auto-filled'); if (input.oninput) input.oninput();
    }
  };
  window.addEventListener('mousemove', onMove); window.addEventListener('touchmove', onMove, {passive: false}); 
  const onEnd = () => { isDragging = false; };
  window.addEventListener('mouseup', onEnd); window.addEventListener('touchend', onEnd);
}

function getNickname() {
  let name = localStorage.getItem('pachinko_nickname');
  if (name && name.trim() !== "") return name.trim();
  if (currentUser && currentUser.email) return currentUser.email.substring(0, 5);
  return "名無し";
}
function updateNickname() {
  const newName = document.getElementById('updateNicknameInput').value.trim();
  if(newName) { localStorage.setItem('pachinko_nickname', newName); alert("ニックネームを更新しました！"); document.getElementById('updateNicknameInput').value = ''; updateModeIndicator(); } 
  else { alert("ニックネームを入力してください。"); }
}
function saveNicknameFromInput() {
  const name = document.getElementById('nicknameInput').value.trim();
  if (name) localStorage.setItem('pachinko_nickname', name); else localStorage.removeItem('pachinko_nickname');
}
function formatCurrency(num) { return (num > 0 ? "+" : "") + Math.round(num).toLocaleString() + " 円"; }

function updateModeIndicator() {
  const n1 = document.getElementById('nav-tab1'), n2 = document.getElementById('nav-tab2'), n3 = document.getElementById('nav-tab3'), hdSection = document.getElementById('history-and-dict-section');
  if (currentGroupId) {
    if(n1) n1.style.display = 'block'; if(n2) n2.style.display = 'block'; if(n3) n3.style.display = 'block';
    document.getElementById('group-none').style.display = 'none'; document.getElementById('group-active').style.display = 'block';
    document.getElementById('dispGroupId').innerText = currentGroupId;
    document.getElementById('dispUserRole').innerText = isAdmin ? "👑 あなたの権限: 管理者 (更新・削除可能)" : "👤 あなたの権限: メンバー (追加・閲覧のみ)";
    document.getElementById('dispNickname').innerText = getNickname(); 
    if(hdSection) hdSection.style.display = 'block';
    const hallSec = document.getElementById('hall-management-section'); if(hallSec) hallSec.style.display = 'block';
  } else {
    if(n1) n1.style.display = 'none'; if(n2) n2.style.display = 'none'; if(n3) n3.style.display = 'none';
    document.getElementById('group-none').style.display = 'block'; document.getElementById('group-active').style.display = 'none';
    if(hdSection) hdSection.style.display = 'none'; 
    const hallSec = document.getElementById('hall-management-section'); if(hallSec) hallSec.style.display = 'none';
    switchTab('tab4');
  }
}

function switchTab(tabId) {
  vibrate(30); 
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.top-nav button').forEach(el => el.classList.remove('active'));
  const targetTab = document.getElementById(tabId); const targetNav = document.getElementById('nav-' + tabId);
  if(targetTab) targetTab.classList.add('active'); if(targetNav) targetNav.classList.add('active');
  refreshActiveTabUI();
}
function refreshActiveTabUI() {
  const activeTabBtn = document.querySelector('.top-nav button.active'); if(!activeTabBtn) return;
  const tabId = activeTabBtn.id.replace('nav-', '');
  if(tabId === 'tab1') renderSavedRecords();
  if(tabId === 'tab3') renderCalendar();
  if(tabId === 'tab4') { renderDictionary(); renderHistoryTab(); renderHalls(); window.analyzeHalls(); }
}

function attachGroupListener(groupId) {
  if (unsubscribeGroup) unsubscribeGroup();
  if (!db || !groupId) return;
  unsubscribeGroup = db.collection('groups').doc(groupId).onSnapshot(doc => {
    if (doc.exists) {
      globalGroupData = doc.data();
      if(!globalGroupData.records) globalGroupData.records = []; if(!globalGroupData.calendar) globalGroupData.calendar = {}; 
      if(!globalGroupData.dictionary) globalGroupData.dictionary = {}; if(!globalGroupData.halls) globalGroupData.halls = {};
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
    currentGroupId = newId; localStorage.setItem('pachinko_groupId', newId); alert(`グループを作成しました！\nID: ${newId}`);
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

window.onload = function() {
  if (localStorage.getItem('pachinko_theme') === 'dark') document.getElementById('darkModeToggle').checked = true;
  const today = new Date(); currentCalYear = today.getFullYear(); currentCalMonth = today.getMonth();
  const yyyy = today.getFullYear(), mm = String(today.getMonth() + 1).padStart(2, '0'), dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;
  
  document.getElementById('recordDate').value = todayStr; document.getElementById('evSaveDate').value = todayStr; document.getElementById('actualDate').value = todayStr;
  document.getElementById('analyzeDate').value = todayStr;
  
  setupSwipeInput('startSpin', 10, 0, 10000, 0);
  setupSwipeInput('measuredSpin', 1, 0, 9999, () => {
    let lastMachineSpin = parseInt(document.getElementById('startSpin').value) || 0;
    historyData.forEach(d => { 
      if (d.type === 'spin' || !d.type) { lastMachineSpin += d.spins; if (d.hitType) lastMachineSpin = 0; }
    }); 
    return lastMachineSpin + 15;
  });
  
  setupSwipeInput('payoutStartBalls', 10, 0, 100000, 0); setupSwipeInput('payoutEndBalls', 10, 0, 100000, 0);
  setupSwipeInput('rType1', 1, 1, 16, 10); setupSwipeInput('rCount1', 1, 0, 100, 0);
  setupSwipeInput('rType2', 1, 1, 16, 3); setupSwipeInput('rCount2', 1, 0, 100, 0);
  setupSwipeInput('rType3', 1, 1, 16, 2); setupSwipeInput('rCount3', 1, 0, 100, 0);
  setupSwipeInput('probDenom', 0.1, 1.0, 499.0, 319.6); setupSwipeInput('avgRounds', 0.1, 1.0, 100.0, 32.2); 
  setupSwipeInput('payoutPerR', 1, 10, 150, 140); setupSwipeInput('spinRate', 0.1, 10.0, 35.0, 20.0); 
  setupSwipeInput('realPayoutPerR', 0.1, 10.0, 150.0, 140.0); setupSwipeInput('exchangeRate', 0.01, 2.50, 4.00, 3.57);
  setupSwipeInput('ballRatio', 1, 0, 100, 60); setupSwipeInput('totalSpins', 10, 100, 15000, 2000);
  setupSwipeInput('calc_b_border', 0.1, 10.0, 30.0, 18.0); setupSwipeInput('calc_b_prob', 0.1, 1.0, 499.0, 319.6);
  setupSwipeInput('calc_b_payout', 1, 10, 160, 140); setupSwipeInput('calc_p_total', 10, 100, 10000, 4500); setupSwipeInput('calc_p_payout', 1, 10, 160, 140);

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
async function getHallsData() { return globalGroupData.halls || {}; }
async function saveRecordsData(records) { if (currentGroupId && db) await db.collection('groups').doc(currentGroupId).set({ records: records }, { merge: true }); }
async function saveCalendarData(calendar) { if (currentGroupId && db) await db.collection('groups').doc(currentGroupId).set({ calendar: calendar }, { merge: true }); }
async function saveDictionaryData(dict) { if (currentGroupId && db) await db.collection('groups').doc(currentGroupId).set({ dictionary: dict }, { merge: true }); }
async function saveHallsData(halls) { if (currentGroupId && db) await db.collection('groups').doc(currentGroupId).set({ halls: halls }, { merge: true }); }

window.calcPayoutAmount = function() {
  const start = parseFloat(document.getElementById('payoutStartBalls').value) || 0;
  const end = parseFloat(document.getElementById('payoutEndBalls').value) || 0;
  let amount = end - start; if(amount < 0) amount = 0;
  document.getElementById('dispPayoutAmount').innerText = amount; document.getElementById('payoutAmount').value = amount;
};
window.calcPayoutRounds = function() {
  const t1 = parseFloat(document.getElementById('rType1').value) || 0, c1 = parseFloat(document.getElementById('rCount1').value) || 0;
  const t2 = parseFloat(document.getElementById('rType2').value) || 0, c2 = parseFloat(document.getElementById('rCount2').value) || 0;
  const t3 = parseFloat(document.getElementById('rType3').value) || 0, c3 = parseFloat(document.getElementById('rCount3').value) || 0;
  const totalR = (t1 * c1) + (t2 * c2) + (t3 * c3);
  document.getElementById('dispPayoutRounds').innerText = totalR; document.getElementById('payoutRounds').value = totalR;
};
window.calcBorder = function() {
  const P = parseFloat(document.getElementById('probDenom').value), avgR = parseFloat(document.getElementById('avgRounds').value), ppr = parseFloat(document.getElementById('payoutPerR').value);
  const borderInput = document.getElementById('border');
  if(P && avgR && ppr) { const border = P / ((avgR * ppr) / 250); borderInput.value = border.toFixed(2); } else { borderInput.value = ""; }
};
window.doAvgRCalc1 = function() {
  const b = parseFloat(document.getElementById('calc_b_border').value), p = parseFloat(document.getElementById('calc_b_prob').value), pr = parseFloat(document.getElementById('calc_b_payout').value);
  const resEl = document.getElementById('res_b_avgR');
  if (b > 0 && p > 0 && pr > 0) { resEl.innerText = ((250 * p) / (b * pr)).toFixed(2); } else { resEl.innerText = "0.00"; }
};
window.doAvgRCalc2 = function() {
  const total = parseFloat(document.getElementById('calc_p_total').value), pr = parseFloat(document.getElementById('calc_p_payout').value);
  const resEl = document.getElementById('res_p_avgR');
  if (total > 0 && pr > 0) { resEl.innerText = (total / pr).toFixed(2); } else { resEl.innerText = "0.00"; }
};
window.applyAvgR = function(spanId) {
  vibrate(); const val = document.getElementById(spanId).innerText;
  if (val === "0.00" || isNaN(val)) return alert("正しく計算されていません。");
  document.getElementById('avgRounds').value = val; document.getElementById('avgRounds').classList.remove('auto-filled');
  if(spanId === 'res_b_avgR') {
    const p = document.getElementById('calc_b_prob').value, pr = document.getElementById('calc_b_payout').value;
    if(p) document.getElementById('probDenom').value = p; if(pr) document.getElementById('payoutPerR').value = pr;
  } else if(spanId === 'res_p_avgR') { const pr = document.getElementById('calc_p_payout').value; if(pr) document.getElementById('payoutPerR').value = pr; }
  window.calcBorder(); window.updateMeasurementDisplay(); closeAvgRCalcModal();
};

window.syncMachineSpec = function() { const m = document.getElementById('machineName').value.trim(); document.getElementById('calcMachineName').value = m; window.loadMachineSpec(); };

async function renderDictionary() {
  const dict = await getDictionaryData(), listEl = document.getElementById('machineList'); let optionsHtml = ''; for(let m in dict) { optionsHtml += `<option value="${m}"></option>`; }
  listEl.innerHTML = optionsHtml; const container = document.getElementById('dictContainer'); let html = '';
  for(let m in dict) {
    const spec = dict[m];
    let adminButtons = isAdmin ? `<div style="display:flex; justify-content:flex-end; gap:5px;"><button class="btn-small" style="background:#3498db;" onclick="updateDictItem('${m}')">更新</button><button class="btn-small" style="background:#e74c3c;" onclick="deleteDictItem('${m}')">削除</button></div>` : '';
    html += `<div class="saved-item" style="border-left: 4px solid #1abc9c;"><div style="font-weight:bold; color:var(--text-main); margin-bottom:8px;">${m}</div><div style="display:flex; gap:5px; margin-bottom:5px;">
      <div style="flex:1"><label style="font-size:11px; margin-bottom:2px;">確率</label><input type="number" id="dict_prob_${m}" value="${spec.probDenom || ''}" step="0.1" style="padding:6px; font-size:14px;" ${!isAdmin?'disabled':''}></div>
      <div style="flex:1"><label style="font-size:11px; margin-bottom:2px;">平均R</label><input type="number" id="dict_avgRounds_${m}" value="${spec.avgRounds || ''}" step="0.1" style="padding:6px; font-size:14px;" ${!isAdmin?'disabled':''}></div>
      <div style="flex:1"><label style="font-size:11px; margin-bottom:2px;">1R出玉</label><input type="number" id="dict_payoutPerR_${m}" value="${spec.payoutPerR || ''}" step="1" style="padding:6px; font-size:14px;" ${!isAdmin?'disabled':''}></div>
      </div>${adminButtons}</div>`;
  }
  if(html === '') html = '<p style="font-size:13px; color:var(--text-muted);">登録されている機種スペックはありません。</p>'; container.innerHTML = html; 
  for(let m in dict) { setupSwipeInput(`dict_prob_${m}`, 0.1, 1.0, 999.0, 319.6); setupSwipeInput(`dict_avgRounds_${m}`, 0.1, 1.0, 100.0, 32.2); setupSwipeInput(`dict_payoutPerR_${m}`, 1, 10, 150, 140); }
}

window.updateDictItem = async function(machine) {
  if (!isAdmin) return alert("権限がありません。");
  const p = parseFloat(document.getElementById(`dict_prob_${machine}`).value), r = parseFloat(document.getElementById(`dict_avgRounds_${machine}`).value), pr = parseFloat(document.getElementById(`dict_payoutPerR_${machine}`).value);
  const dict = await getDictionaryData(); if(!dict[machine]) dict[machine] = {};
  if(!isNaN(p)) dict[machine].probDenom = p; if(!isNaN(r)) dict[machine].avgRounds = r; if(!isNaN(pr)) dict[machine].payoutPerR = pr;
  await saveDictionaryData(dict); alert(`[${machine}] の辞書を更新しました。`);
};
window.deleteDictItem = async function(machine) {
  if (!isAdmin) return alert("権限がありません。");
  if(confirm(`[${machine}] を辞書から削除しますか？`)) { const dict = await getDictionaryData(); delete dict[machine]; await saveDictionaryData(dict); }
};

window.saveHall = async function() {
  if (!isAdmin) return alert("権限がありません。");
  const name = document.getElementById('hallNameInput').value.trim(); if (!name) return alert("ホール名を入力してください。");
  const checkboxes = document.querySelectorAll('input[name="hallRule"]:checked'); const rules = Array.from(checkboxes).map(cb => cb.value);
  if (rules.length === 0) return alert("特定日ルールを1つ以上選択してください。");
  const halls = await getHallsData(); halls[name] = { rules: rules }; await saveHallsData(halls); alert(`${name} を登録しました。`);
  document.getElementById('hallNameInput').value = ''; checkboxes.forEach(cb => cb.checked = false); renderHalls(); analyzeHalls();
};

window.deleteHall = async function(name) {
  if (!isAdmin) return alert("権限がありません。");
  if(confirm(`[${name}] を削除しますか？`)) { const halls = await getHallsData(); delete halls[name]; await saveHallsData(halls); renderHalls(); analyzeHalls(); }
};

window.renderHalls = async function() {
  const halls = await getHallsData(); const container = document.getElementById('hallListContainer'); let html = '';
  for(let name in halls) {
    const rules = halls[name].rules.join(', ');
    let adminBtn = isAdmin ? `<button class="btn-small" style="background:#e74c3c; margin:0;" onclick="deleteHall('${name}')">削除</button>` : '';
    html += `<div class="saved-item" style="border-left: 4px solid #27ae60; display: flex; justify-content: space-between; align-items: center;"><div><div style="font-weight:bold; color:var(--text-main); font-size:14px;">${name}</div><div style="font-size:12px; color:var(--text-sub);">特定日: ${rules}</div></div>${adminBtn}</div>`;
  }
  if(html === '') html = '<p style="font-size:13px; color:var(--text-muted);">登録されているホールはありません。</p>'; container.innerHTML = html;
};

window.analyzeHalls = async function() {
  const dateStr = document.getElementById('analyzeDate').value; const container = document.getElementById('analyzeResultContainer');
  if(!dateStr) { container.innerHTML = ''; return; }
  const dateObj = new Date(dateStr), day = dateObj.getDate(), lastDigit = day.toString().slice(-1), isZorome = (day === 11 || day === 22);
  const halls = await getHallsData(), records = await getRecordsData(); let targetHalls = [];
  for(let name in halls) {
    const rules = halls[name].rules; let isTarget = false;
    if (rules.includes(lastDigit)) isTarget = true;
    if (isZorome && rules.includes("ゾロ目")) isTarget = true;
    if (isTarget) targetHalls.push(name);
  }
  if (targetHalls.length === 0) { container.innerHTML = `<p style="font-size:13px; color:var(--text-sub); margin-top:15px;">${dateStr} が特定日のホールはありません。</p>`; return; }
  
  let html = `<div style="font-weight:bold; color:var(--text-main); margin: 15px 0 10px 0;">🔥 ${dateStr} の熱いホール</div>`;
  targetHalls.forEach(hallName => {
    const hallRecords = records.filter(r => r.store === hallName);
    let totalSpins = 0, totalBalls = 0, machineCount = {};
    hallRecords.forEach(r => { totalSpins += r.totalSpins || 0; totalBalls += r.totalBalls || 0; if (r.machine) machineCount[r.machine] = (machineCount[r.machine] || 0) + 1; });
    let avg250 = totalBalls > 0 ? (totalSpins / totalBalls) * 250 : 0; let mainMachine = "-", maxCount = 0;
    for(let m in machineCount) { if (machineCount[m] > maxCount) { maxCount = machineCount[m]; mainMachine = m; } }
    let dataHtml = '';
    if (hallRecords.length > 0) { dataHtml = `<div style="font-size:12px; color:var(--text-sub); margin-top:5px; padding:8px; background:var(--bg-main); border-radius:4px;"><div>過去の平均回転数: <span style="color:#e74c3c; font-weight:bold; font-size:14px;">${avg250.toFixed(2)} 回/k</span> (サンプル: ${hallRecords.length}件)</div><div style="margin-top:4px;">メイン機種: <strong>${mainMachine}</strong></div></div>`; } 
    else { dataHtml = `<div style="font-size:12px; color:var(--text-muted); margin-top:5px;">過去の稼働データはありません。</div>`; }
    html += `<div class="saved-item" style="border-left: 4px solid #e67e22; margin-bottom: 10px;"><div style="font-weight:bold; color:var(--text-main); font-size:15px;">${hallName}</div><div style="font-size:12px; color:var(--text-sub); margin-bottom: 5px;">特定日ルール: ${halls[hallName].rules.join(', ')}</div>${dataHtml}</div>`;
  });
  container.innerHTML = html;
};

// 履歴編集機能
window.editHistoryItem = function(index) { editingHistoryIndex = index; updateMeasurementDisplay(); };
window.cancelEditHistoryItem = function() { editingHistoryIndex = null; updateMeasurementDisplay(); };

window.saveEditHistoryItem = function(index, type) {
  if (type === 'spin') {
    const b = parseInt(document.getElementById(`edit_balls_${index}`).value), s = parseFloat(document.getElementById(`edit_spins_${index}`).value), m = document.getElementById(`edit_mochi_${index}`).value === 'true', h = document.getElementById(`edit_hit_${index}`).value;
    if (isNaN(b) || isNaN(s)) return alert('玉数と回転数を正しく入力してください。');
    historyData[index].balls = b; historyData[index].spins = s; historyData[index].isMochidama = m; historyData[index].hitType = h || null;
  } else if (type === 'payout') {
    const a = parseFloat(document.getElementById(`edit_amount_${index}`).value), r = parseFloat(document.getElementById(`edit_rounds_${index}`).value), h = document.getElementById(`edit_hitType_${index}`).value, memo = document.getElementById(`edit_memo_${index}`).value;
    if (isNaN(a) || isNaN(r)) return alert('獲得出玉とラウンド数を正しく入力してください。');
    historyData[index].amount = a; historyData[index].rounds = r; historyData[index].hitType = h; historyData[index].memo = memo;
  }
  editingHistoryIndex = null; vibrate(30); updateMeasurementDisplay();
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
        historyHtml += `<div style="margin-bottom: 4px; background-color:var(--box-yellow-bg); padding: 2px 4px; border-radius:2px; font-size:11px;"><span style="color:#d35400; font-weight:bold;">🎉 ${h.hitType}獲得: ${h.amount}玉 (${h.rounds}R)${memoHtml}</span></div>`;
      }
    });
    historyHtml += `</div></details>`;
  }
  let dispRatio = (r.mochidamaRatio || 0).toFixed(1), startDisp = (r.startSpins !== undefined && r.startSpins >= 0) ? ` <span style="color:var(--text-muted); font-size:11px;">(開始${r.startSpins}G → 終了${r.startSpins + r.totalSpins}G)</span>` : '';
  let storeDisp = r.store ? `<span style="color:var(--text-muted); font-size:12px; margin-right:6px;">[${r.store}]</span>` : '', authorDisp = r.author ? `<span class="author-badge">👤 ${r.author}</span>` : '';
  
  const totalPayoutRounds = r.history ? r.history.reduce((sum, h) => sum + (h.rounds || 0), 0) : 0;
  const realPayoutPerR = totalPayoutRounds > 0 ? ((r.totalPayout || 0) / totalPayoutRounds) : 0;

  const safeStr = encodeURIComponent(JSON.stringify(r.hitHistory || [])), safeHist = encodeURIComponent(JSON.stringify(r.history || []));
  const btnCall = `useRecordForCalc('${r.date}', ${r.avg250}, '${r.machine}', ${r.mochidamaRatio || 0}, '${r.store || ''}', ${r.totalCashBalls || 0}, ${r.totalMochiBalls || 0}, ${r.totalPayout || 0}, ${realPayoutPerR}, '${safeStr}', '${safeHist}')`;
  let resumeButton = `<button class="btn-small" style="background:#f39c12;" onclick="resumeRecord(${r.id})">続きを計測</button>`;
  let adminButtons = isAdmin ? `<button class="btn-small" style="background:#95a5a6;" onclick="deleteRecord(${r.id})">削除</button>` : '';

  return `<div class="saved-item"><div style="font-weight:bold; color:var(--text-main); font-size: 15px;">${r.date} ｜ ${storeDisp}${r.machine}${authorDisp}</div><div style="font-size:13px; margin:6px 0; color:var(--text-sub);">総投資: ${r.totalBalls}玉 / 自力回転: ${r.totalSpins}回${startDisp}<br><span style="color:#e74c3c; font-weight:bold; font-size:14px;">250玉平均: ${r.avg250.toFixed(2)} 回</span><span style="color:#e67e22; font-weight:bold; font-size:13px; margin-left:10px;">持球比率: ${dispRatio}%</span></div>${historyHtml}<div style="margin-top: 10px; display: flex; gap: 4px; flex-wrap: wrap;">${resumeButton}<button class="btn-small" style="background:#3498db;" onclick="${btnCall}">期待値を計算</button>${adminButtons}</div></div>`;
}

window.addMeasurement = function(balls) {
  vibrate();
  const spinInput = document.getElementById('measuredSpin'), currentMachineSpin = parseFloat(spinInput.value);
  if (isNaN(currentMachineSpin) || currentMachineSpin < 0) return alert("現在のデータ機回転数を正しく入力してください。");
  
  let lastMachineSpin = parseInt(document.getElementById('startSpin').value) || 0;
  historyData.forEach(d => { if (d.type === 'spin' || !d.type) { lastMachineSpin += d.spins; if (d.hitType) lastMachineSpin = 0; } });
  
  const spins = currentMachineSpin - lastMachineSpin;
  if (spins <= 0) return alert(`現在の回転数は、前回の回転数 (${lastMachineSpin}回) より大きい数値を入力してください。`);
  
  const isMochi = document.getElementById('isMochidama').checked, hitType = document.getElementById('hitNormal').checked ? '通常' : (document.getElementById('hitRush').checked ? 'ラッシュ' : null);
  historyData.push({ type: 'spin', balls: balls, spins: spins, isMochidama: isMochi, hitType: hitType });
  spinInput.value = ''; if (!measurementStartTime) measurementStartTime = Date.now(); editingHistoryIndex = null;
  
  if (hitType) {
    document.getElementById('payoutTitle').innerText = `${hitType}当たり 結果を入力`;
    ['payoutStartBalls', 'payoutEndBalls', 'rType1', 'rCount1', 'rType2', 'rCount2', 'rType3', 'rCount3', 'payoutMemo'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('payoutAmount').value = '0'; document.getElementById('dispPayoutAmount').innerText = '0';
    document.getElementById('payoutRounds').value = '0'; document.getElementById('dispPayoutRounds').innerText = '0';
    document.getElementById('payoutInputArea').style.display = 'block';
  } else { document.getElementById('payoutInputArea').style.display = 'none'; }
  updateMeasurementDisplay();
};

window.addPayout = function() {
  vibrate();
  const amount = parseFloat(document.getElementById('payoutAmount').value), rounds = parseFloat(document.getElementById('payoutRounds').value);
  if (isNaN(amount) || amount <= 0) return alert("獲得出玉が計算されていません。（終了時の持ち球を入力してください）");
  if (isNaN(rounds) || rounds <= 0) return alert("消化ラウンド数が計算されていません。（ラウンド数と回数を入力してください）");

  const hitType = document.getElementById('hitNormal').checked ? '通常' : (document.getElementById('hitRush').checked ? 'ラッシュ' : '不明');
  historyData.push({ type: 'payout', amount: amount, rounds: rounds, hitType: hitType, memo: document.getElementById('payoutMemo').value.trim() });
  
  document.getElementById('hitNormal').checked = false; document.getElementById('hitRush').checked = false;
  document.getElementById('payoutInputArea').style.display = 'none';
  if (!measurementStartTime) measurementStartTime = Date.now(); editingHistoryIndex = null; updateMeasurementDisplay();
};

window.undoLastInput = function() {
  if (historyData.length === 0) return alert("取り消す入力がありません。");
  if (!confirm("直前の入力を取り消しますか？\n※この操作は元に戻せません。")) return;
  vibrate(40); historyData.pop(); if (historyData.length === 0) measurementStartTime = null; editingHistoryIndex = null; updateMeasurementDisplay();
};

window.deleteHistoryItem = function(index) { historyData.splice(index, 1); updateMeasurementDisplay(); };

window.updateMeasurementDisplay = function() {
  const btnModal = document.getElementById('btnOpenResultModal'); const startSpinInput = document.getElementById('startSpin');

  if (historyData.length === 0) { 
    startSpinInput.disabled = false; startSpinInput.style.backgroundColor = "var(--input-bg)";
    btnModal.innerText = "📊 入力データを確認 (未入力)"; document.getElementById('avg250').innerText = "0.00 回"; 
    document.getElementById('historyList').innerHTML = ""; document.getElementById('workValueArea').innerHTML = ""; return; 
  }
  
  startSpinInput.disabled = true; startSpinInput.style.backgroundColor = "var(--bg-main)";
  
  let totalBalls = 0, totalSpins = 0, mochidamaBalls = 0, historyHtml = '', spinCount = 0; let totalPayoutAmount = 0, totalPayoutRounds = 0;
  for (let i = 0; i < historyData.length; i++) {
    let item = historyData[i]; let itemHtml = '';
    
    if (item.type === 'spin' || !item.type) { spinCount++; totalBalls += item.balls; totalSpins += item.spins; if (item.isMochidama) mochidamaBalls += item.balls; } 
    else if (item.type === 'payout') { totalPayoutAmount += item.amount; if(item.rounds) totalPayoutRounds += item.rounds; }

    if (editingHistoryIndex === i) {
      if (item.type === 'spin' || !item.type) {
        itemHtml = `<div class="history-item" style="flex-direction:column; align-items:flex-start; background:var(--box-blue-bg); padding:10px; border:1px solid #3498db; border-radius:6px; margin:4px 0;"><div style="font-weight:bold; margin-bottom:8px; color:#2980b9; font-size:12px;">${spinCount}回目の計測を編集</div><div style="display:flex; gap:5px; width:100%; margin-bottom:5px;"><div style="flex:1"><label style="font-size:10px; margin-bottom:2px;">使用玉数</label><input type="number" id="edit_balls_${i}" value="${item.balls}" style="width:100%; padding:6px; border:1px solid var(--border-color); border-radius:4px; font-size:14px; background:var(--input-bg); color:var(--text-main);"></div><div style="flex:1"><label style="font-size:10px; margin-bottom:2px;">回転数</label><input type="number" id="edit_spins_${i}" value="${item.spins}" style="width:100%; padding:6px; border:1px solid var(--border-color); border-radius:4px; font-size:14px; background:var(--input-bg); color:var(--text-main);"></div></div><div style="display:flex; gap:5px; width:100%;"><div style="flex:1"><label style="font-size:10px; margin-bottom:2px;">玉の種類</label><select id="edit_mochi_${i}" style="width:100%; padding:6px; border:1px solid var(--border-color); border-radius:4px; font-size:14px; background:var(--input-bg); color:var(--text-main);"><option value="false" ${!item.isMochidama ? 'selected' : ''}>現金</option><option value="true" ${item.isMochidama ? 'selected' : ''}>持球</option></select></div><div style="flex:1"><label style="font-size:10px; margin-bottom:2px;">当り有無</label><select id="edit_hit_${i}" style="width:100%; padding:6px; border:1px solid var(--border-color); border-radius:4px; font-size:14px; background:var(--input-bg); color:var(--text-main);"><option value="" ${!item.hitType ? 'selected' : ''}>当り無し</option><option value="通常" ${item.hitType === '通常' ? 'selected' : ''}>通常</option><option value="ラッシュ" ${item.hitType === 'ラッシュ' ? 'selected' : ''}>ラッシュ</option></select></div></div><div style="margin-top:10px; display:flex; gap:8px; width:100%; justify-content:flex-end;"><button class="btn-small" style="background:#7f8c8d; margin:0;" onclick="cancelEditHistoryItem()">キャンセル</button><button class="btn-small" style="background:#3498db; margin:0;" onclick="saveEditHistoryItem(${i}, 'spin')">保存して再計算</button></div></div>`;
      } else if (item.type === 'payout') {
        itemHtml = `<div class="history-item" style="flex-direction:column; align-items:flex-start; background:var(--box-yellow-bg); padding:10px; border:1px solid #f39c12; border-radius:6px; margin:4px 0;"><div style="font-weight:bold; margin-bottom:8px; color:#d35400; font-size:12px;">出玉記録を編集</div><div style="display:flex; gap:5px; width:100%; margin-bottom:5px;"><div style="flex:1"><label style="font-size:10px; margin-bottom:2px; color:#d35400;">獲得出玉</label><input type="number" id="edit_amount_${i}" value="${item.amount}" style="width:100%; padding:6px; border:1px solid #f39c12; border-radius:4px; font-size:14px; background:var(--input-bg); color:var(--text-main);"></div><div style="flex:1"><label style="font-size:10px; margin-bottom:2px; color:#d35400;">R数</label><input type="number" id="edit_rounds_${i}" value="${item.rounds || 0}" style="width:100%; padding:6px; border:1px solid #f39c12; border-radius:4px; font-size:14px; background:var(--input-bg); color:var(--text-main);"></div></div><div style="display:flex; gap:5px; width:100%;"><div style="flex:1"><label style="font-size:10px; margin-bottom:2px; color:#d35400;">種類</label><select id="edit_hitType_${i}" style="width:100%; padding:6px; border:1px solid #f39c12; border-radius:4px; font-size:14px; background:var(--input-bg); color:var(--text-main);"><option value="通常" ${item.hitType === '通常' ? 'selected' : ''}>通常</option><option value="ラッシュ" ${item.hitType === 'ラッシュ' ? 'selected' : ''}>ラッシュ</option><option value="不明" ${item.hitType === '不明' ? 'selected' : ''}>不明</option></select></div><div style="flex:1"><label style="font-size:10px; margin-bottom:2px; color:#d35400;">備考</label><input type="text" id="edit_memo_${i}" value="${item.memo || ''}" style="width:100%; padding:6px; border:1px solid #f39c12; border-radius:4px; font-size:14px; background:var(--input-bg); color:var(--text-main);"></div></div><div style="margin-top:10px; display:flex; gap:8px; width:100%; justify-content:flex-end;"><button class="btn-small" style="background:#7f8c8d; margin:0;" onclick="cancelEditHistoryItem()">キャンセル</button><button class="btn-small" style="background:#e67e22; margin:0;" onclick="saveEditHistoryItem(${i}, 'payout')">保存して再計算</button></div></div>`;
      }
    } else {
      if (item.type === 'spin' || !item.type) {
        let cvt = item.balls === 125 ? `<span style="font-size:11px; color:var(--text-muted); margin-left:6px;">(250玉換算: ${item.spins * 2}回)</span>` : "";
        let typeLabel = item.isMochidama ? `<span style="color:#e67e22; font-size:11px; margin-left:4px;">[持球]</span>` : `<span style="color:#27ae60; font-size:11px; margin-left:4px;">[現金]</span>`;
        let hitLabel = item.hitType ? `<span style="color:#d35400; font-size:11px; margin-left:4px; font-weight:bold;">[${item.hitType}当たり!]</span>` : "";
        itemHtml = `<div class="history-item"><div style="line-height:1.4;"><span style="display:inline-block; min-width:35px;">${spinCount}回目</span>: ${item.balls}玉で <strong>${item.spins}回</strong>${typeLabel}${hitLabel}<br>${cvt}</div><div style="display:flex; flex-direction:column; gap:4px; margin-left:8px;"><button class="btn-small" style="background:#3498db; margin:0; padding:4px 8px;" onclick="editHistoryItem(${i})">✏️</button><button class="btn-small" style="background:#e74c3c; margin:0; padding:4px 8px;" onclick="deleteHistoryItem(${i})">✖️</button></div></div>`;
      } else if (item.type === 'payout') {
        let memoHtml = item.memo ? `<span style="font-size:11px; color:var(--text-muted); margin-left:6px;">(${item.memo})</span>` : "";
        itemHtml = `<div class="history-item" style="background-color:var(--box-yellow-bg); padding:4px 8px; border-radius:4px; margin-top:2px; margin-bottom:2px;"><div style="color:#d35400; font-weight:bold; font-size:13px; line-height:1.4;">🎉 ${item.hitType}獲得: ${item.amount}玉 (${item.rounds}R)${memoHtml}</div><div style="display:flex; flex-direction:column; gap:4px; margin-left:8px;"><button class="btn-small" style="background:#3498db; margin:0; padding:4px 8px;" onclick="editHistoryItem(${i})">✏️</button><button class="btn-small" style="background:#e74c3c; margin:0; padding:4px 8px;" onclick="deleteHistoryItem(${i})">✖️</button></div></div>`;
      }
    }
    historyHtml = itemHtml + historyHtml; 
  }
  historyHtml = '<strong>入力履歴:</strong><br>' + historyHtml;
  
  const avg250 = totalBalls > 0 ? (totalSpins / totalBalls) * 250 : 0; const mochiRatio = totalBalls > 0 ? (mochidamaBalls / totalBalls * 100) : 0;
  const startSpin = parseInt(startSpinInput.value) || 0, absoluteTotalSpins = startSpin + totalSpins;
  
  document.getElementById('avg250').innerText = avg250.toFixed(2) + " 回"; document.getElementById('dispMochiRatio').innerText = mochiRatio.toFixed(1) + " %";
  document.getElementById('totalMeasuredSpins').innerText = totalSpins + " 回"; document.getElementById('absoluteTotalSpins').innerText = absoluteTotalSpins + " 回";
  document.getElementById('totalMeasuredBalls').innerText = totalBalls + " 玉"; document.getElementById('historyList').innerHTML = historyHtml;
  
  let realPayoutPerR = totalPayoutRounds > 0 ? (totalPayoutAmount / totalPayoutRounds) : 0;
  const P = parseFloat(document.getElementById('probDenom').value), avgR = parseFloat(document.getElementById('avgRounds').value), specPayoutPerR = parseFloat(document.getElementById('payoutPerR').value);
  const currentPayoutR = realPayoutPerR > 0 ? realPayoutPerR : specPayoutPerR;

  let workValueHtml = ""; let spinsPerHour = 0;
  if (measurementStartTime && totalSpins > 0) { const elapsedMinutes = (Date.now() - measurementStartTime) / 60000; if (elapsedMinutes > 3) spinsPerHour = totalSpins / (elapsedMinutes / 60); }

  if (P && avgR && currentPayoutR && avg250 > 0) {
    const E_out = avgR * currentPayoutR, Ex = parseFloat(document.getElementById('exchangeRate').value) || 4.0, M = mochiRatio / 100;
    const costPerSpin = (250 / avg250) * (M * Ex + (1 - M) * 4.0), returnPerSpin = (E_out / P) * Ex, unitPrice = returnPerSpin - costPerSpin;
    const workValue = unitPrice * totalSpins, hourlyWage = unitPrice * spinsPerHour;
    
    workValueHtml = `<hr><p><span>実測1R出玉:</span> <span style="font-weight:bold; color:#e67e22;">${realPayoutPerR > 0 ? realPayoutPerR.toFixed(1) : '-'} 玉</span></p><p><span>現在の回転単価:</span> <span style="font-weight:bold;">${unitPrice.toFixed(2)} 円</span></p><p><span>積んだ仕事量:</span> <span class="highlight" style="color:#27ae60;">${Math.round(workValue).toLocaleString()} 円</span></p><p><span>現在の期待時給:</span> <span style="font-weight:bold;">${hourlyWage > 0 ? Math.round(hourlyWage).toLocaleString() + ' 円' : '-'}</span></p>`;
    
    document.getElementById('spinRate').value = avg250.toFixed(2); document.getElementById('spinRate').classList.add('auto-filled');
    if (realPayoutPerR > 0) { document.getElementById('realPayoutPerR').value = realPayoutPerR.toFixed(1); document.getElementById('realPayoutPerR').classList.add('auto-filled'); }
  } else { workValueHtml = `<hr><p style="font-size:11px; color:var(--text-muted);">※「設定」タブの辞書でスペックを入力すると、仕事量が自動計算されます。</p>`; }
  document.getElementById('workValueArea').innerHTML = workValueHtml;

  let speedHtml = spinsPerHour > 0 ? ` / 時速:${Math.round(spinsPerHour)}回` : "";
  btnModal.innerText = `📊 データ確認 (投資:${totalBalls}玉 / 平均:${avg250.toFixed(1)}回${speedHtml})`;

  if (editingRecordId) { document.getElementById('btnSaveRecord').innerText = "この記録を上書き保存"; document.getElementById('btnSaveRecord').style.backgroundColor = "#d35400"; } 
  else { document.getElementById('btnSaveRecord').innerText = "この記録を保存"; document.getElementById('btnSaveRecord').style.backgroundColor = "#e67e22"; }
}

window.resetMeasurement = function() {
  if(confirm("現在の入力データをすべてクリアしますか？")) { 
    historyData = []; editingRecordId = null; measurementStartTime = null; editingHistoryIndex = null;
    document.getElementById('startSpin').value = ''; document.getElementById('hitNormal').checked = false; document.getElementById('hitRush').checked = false;
    document.getElementById('payoutAmount').value = ''; document.getElementById('payoutRounds').value = ''; document.getElementById('payoutMemo').value = ''; document.getElementById('payoutInputArea').style.display = 'none';
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
    const P = parseFloat(document.getElementById('probDenom').value), avgR = parseFloat(document.getElementById('avgRounds').value), pr = parseFloat(document.getElementById('payoutPerR').value);
    if(P && avgR && pr) {
      const dict = await getDictionaryData();
      if (!dict[machine]) { dict[machine] = { probDenom: P, avgRounds: avgR, payoutPerR: pr }; await saveDictionaryData(dict); renderDictionary(); }
    }
  }
  
  const records = await getRecordsData();
  const newRecord = { 
    id: editingRecordId ? editingRecordId : Date.now(), date: date, store: store, machine: machine, author: getNickname(), 
    totalBalls: totalBalls, totalSpins: totalSpins, startSpins: startSpin, totalCashBalls: cashBalls, totalMochiBalls: mochidamaBalls, totalPayout: totalPayout,
    avg250: avg250, mochidamaRatio: mochiRatio, history: [...historyData], hitHistory: hitHistory
  };
  
  if (editingRecordId) { const idx = records.findIndex(rec => rec.id === editingRecordId); if(idx !== -1) records[idx] = newRecord; else records.push(newRecord); editingRecordId = null; } else { records.push(newRecord); }
  await saveRecordsData(records); alert(`${machine} のデータを保存しました。`);
  
  historyData = []; measurementStartTime = null; editingHistoryIndex = null;
  document.getElementById('machineName').value = ''; document.getElementById('startSpin').value = '';
  document.getElementById('hitNormal').checked = false; document.getElementById('hitRush').checked = false;
  document.getElementById('payoutAmount').value = ''; document.getElementById('payoutRounds').value = ''; document.getElementById('payoutMemo').value = ''; document.getElementById('payoutInputArea').style.display = 'none';
  updateMeasurementDisplay(); closeResultModal(); 
};

window.resumeRecord = async function(id) {
  if(!confirm("このデータの続きを計測しますか？\n※現在入力中のデータがある場合、破棄されて上書きされます。")) return;
  const records = await getRecordsData(); const r = records.find(rec => rec.id === id); if(!r) return;
  
  document.getElementById('recordDate').value = r.date || ''; document.getElementById('storeName').value = r.store || '';
  document.getElementById('machineName').value = r.machine || ''; document.getElementById('startSpin').value = r.startSpins || 0;
  historyData = JSON.parse(JSON.stringify(r.history || [])); editingRecordId = r.id; measurementStartTime = Date.now(); editingHistoryIndex = null;
  document.getElementById('hitNormal').checked = false; document.getElementById('hitRush').checked = false;
  document.getElementById('payoutAmount').value = ''; document.getElementById('payoutRounds').value = ''; document.getElementById('payoutMemo').value = ''; document.getElementById('payoutInputArea').style.display = 'none';
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
  if(!machine) return; const dict = await getDictionaryData();
  if(dict[machine]) {
    const spec = dict[machine];
    if(spec.probDenom) { document.getElementById('probDenom').value = spec.probDenom; document.getElementById('probDenom').classList.add('auto-filled'); }
    if(spec.avgRounds) { document.getElementById('avgRounds').value = spec.avgRounds; document.getElementById('avgRounds').classList.add('auto-filled'); }
    if(spec.payoutPerR) { document.getElementById('payoutPerR').value = spec.payoutPerR; document.getElementById('payoutPerR').classList.add('auto-filled'); }
    window.calcBorder();
  }
};

window.useRecordForCalc = async function(recordDate, avg, machineName, mochidamaRatio, storeName, cashBalls, mochiBalls, payout, realPayoutPerR, hitHistoryStr, historyStr) {
  currentPassData = { cashBalls: cashBalls || 0, mochiBalls: mochiBalls || 0, payout: payout || 0, hitHistory: hitHistoryStr ? JSON.parse(decodeURIComponent(hitHistoryStr)) : [], history: historyStr ? JSON.parse(decodeURIComponent(historyStr)) : [] };
  document.getElementById('calcMachineName').value = machineName || ""; await window.loadMachineSpec(); 
  document.getElementById('spinRate').value = avg.toFixed(2); document.getElementById('spinRate').classList.add('auto-filled');
  if (realPayoutPerR > 0) { document.getElementById('realPayoutPerR').value = realPayoutPerR.toFixed(1); document.getElementById('realPayoutPerR').classList.add('auto-filled'); }
  if (mochidamaRatio !== undefined) { document.getElementById('ballRatio').value = Math.round(mochidamaRatio); document.getElementById('ballRatio').classList.add('auto-filled'); }
  if (recordDate) document.getElementById('evSaveDate').value = recordDate; document.getElementById('evSaveStore').value = storeName || ""; 
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
  slumpChartInstance = new Chart(ctx, { type: 'line', data: { datasets: [{ label: '差玉 (玉)', data: chartData, borderColor: '#3498db', backgroundColor: 'rgba(52, 152, 219, 0.1)', borderWidth: 2, pointRadius: 2, pointBackgroundColor: '#e67e22', fill: true, stepped: false }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { type: 'linear', title: { display: true, text: '累積投資玉数 (玉)', font: {size: 11} }, min: 0 }, y: { title: { display: true, text: '差玉 (玉)', font: {size: 11} } } }, plugins: { legend: { display: false } } } });
}

window.calculateAndSimulate = function() {
  vibrate(); 
  const inputs = [
    { id: 'probDenom', name: '初当たり確率' }, { id: 'avgRounds', name: '平均ラウンド数' },
    { id: 'payoutPerR', name: '1R表記出玉' }, { id: 'spinRate', name: '現在の平均回転数' },
    { id: 'exchangeRate', name: '交換率' }, { id: 'ballRatio', name: '持ち球比率' }, { id: 'totalSpins', name: '総回転数' }
  ];
  let missing = []; inputs.forEach(item => { if (!document.getElementById(item.id).value) missing.push(item.name); });
  if (missing.length > 0) return alert("以下の項目が未入力です：\n・" + missing.join("\n・"));

  const P = parseFloat(document.getElementById('probDenom').value), avgR = parseFloat(document.getElementById('avgRounds').value);
  const specPayoutPerR = parseFloat(document.getElementById('payoutPerR').value), realPayoutPerR = parseFloat(document.getElementById('realPayoutPerR').value) || specPayoutPerR;
  const R = parseFloat(document.getElementById('spinRate').value), E = parseFloat(document.getElementById('exchangeRate').value);
  const M = parseFloat(document.getElementById('ballRatio').value) / 100, totalSpins = parseFloat(document.getElementById('totalSpins').value);

  const E_out = avgR * realPayoutPerR; 
  const returnPerSpin = (E_out / P) * E;
  const costPerSpin = (250 / R) * (M * E + (1 - M) * 4.0);
  const evSpin = returnPerSpin - costPerSpin; 
  lastCalculatedEV = evSpin * totalSpins; 

  document.getElementById('resSpin').innerText = evSpin.toFixed(2) + " 円";
  document.getElementById('resTotal').innerText = formatCurrency(Math.ceil(lastCalculatedEV));
  document.getElementById('resultArea').style.display = 'block';

  const btn = document.querySelector('button[onclick="calculateAndSimulate()"]');
  if(btn) btn.innerText = "🚀 10万回シミュレート中...";

  const worker = new Worker('./worker.js');
  worker.postMessage({ R: R, E: E, M: M, totalSpins: totalSpins, P: P, E_out: E_out });
  
  worker.onmessage = function(e) {
    if(btn) btn.innerText = "期待値を計算＆シミュレート";
    const data = e.data;
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

  const cal = await getCalendarData(); if(!cal[date]) cal[date] = { ev: 0, actual: 0, actualBalls: 0, details: [] };
  cal[date].ev = (cal[date].ev || 0) + lastCalculatedEV; cal[date].actual = (cal[date].actual || 0) + actualAmt; cal[date].actualBalls = (cal[date].actualBalls || 0) + diffBalls;
  cal[date].details.push(`[${store}] ${machine} (期待値: ${formatCurrency(Math.ceil(lastCalculatedEV))} / 実収支: ${formatCurrency(actualAmt)}) <span style="font-size:11px; color:var(--text-muted);">👤 ${getNickname()}</span>${hitText}`);
  await saveCalendarData(cal); alert(`${date} の収支にデータを保存しました。`); renderCalendar();

  document.getElementById('calcMachineName').value = ''; document.getElementById('border').value = ''; document.getElementById('spinRate').value = ''; document.getElementById('exchangeRate').value = '';
  document.getElementById('ballRatio').value = ''; document.getElementById('totalSpins').value = ''; document.getElementById('probDenom').value = ''; document.getElementById('avgRounds').value = ''; document.getElementById('payoutPerR').value = ''; document.getElementById('realPayoutPerR').value = '';
  document.getElementById('evSaveStore').value = ''; document.getElementById('evSaveMachine').value = '';
  const today = new Date(), yyyy = today.getFullYear(), mm = String(today.getMonth() + 1).padStart(2, '0'), dd = String(today.getDate()).padStart(2, '0');
  document.getElementById('evSaveDate').value = `${yyyy}-${mm}-${dd}`;
  document.getElementById('resultArea').style.display = 'none'; document.getElementById('simArea').style.display = 'none';
  if(document.getElementById('graphContainer')) document.getElementById('graphContainer').style.display = 'none';
  ['probDenom', 'avgRounds', 'payoutPerR', 'spinRate', 'realPayoutPerR', 'ballRatio'].forEach(id => { const el = document.getElementById(id); if(el) el.classList.remove('auto-filled'); });
  lastCalculatedEV = 0; currentPassData = null;
};

// ==========================================
// ★ ツール③：カレンダー機能 ＆ ランキング自動集計
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

  // ★ 月間ランキング用ユーザー別集計
  let userStats = {};

  for(let day=1; day<=daysInMonth; day++){
    const dateStr = `${monthStr}-${String(day).padStart(2,'0')}`, dayData = cal[dateStr], currentDayOfWeek = (firstDay + day - 1) % 7;
    let dateColor = currentDayOfWeek === 0 ? '#e74c3c' : (currentDayOfWeek === 6 ? '#2980b9' : 'var(--text-main)');
    let cellContent = `<div class="cal-date" style="color:${dateColor};">${day}</div>`;
    
    if(dayData) {
      const ceiledEV = Math.ceil(dayData.ev || 0), actualVal = dayData.actual || 0, actualBallsVal = dayData.actualBalls || 0;
      monthlyEV += ceiledEV; monthlyActual += actualVal; monthlyBalls += actualBallsVal;
      if(dayData.ev) cellContent += `<div class="cal-val ev">期:${ceiledEV.toLocaleString()}</div>`;
      if(dayData.actual) { const aClass = actualVal >= 0 ? 'plus' : 'minus'; cellContent += `<div class="cal-val ${aClass}">実:${actualVal.toLocaleString()}</div>`; }
      
      // ★ 正規表現を使って保存された文字列からユーザー別の「期待値」と「実収支」を抽出・合算
      if (dayData.details && Array.isArray(dayData.details)) {
        dayData.details.forEach(detail => {
          const match = detail.match(/期待値:\s*([+-]?[\d,]+)\s*円\s*\/\s*実収支:\s*([+-]?[\d,]+)\s*円.*👤\s*(.*?)<\/span>/);
          if (match) {
            let ev = parseInt(match[1].replace(/,/g, '')) || 0;
            let actual = parseInt(match[2].replace(/,/g, '')) || 0;
            let name = match[3].trim();
            if (!userStats[name]) userStats[name] = { ev: 0, actual: 0 };
            userStats[name].ev += ev;
            userStats[name].actual += actual;
          }
        });
      }
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

  // ★ ランキングダッシュボードとアバターの更新ロジック
  updateRankingAndAvatar(userStats);
}

function updateRankingAndAvatar(userStats) {
  // 1. 自分のアバター更新
  const myName = getNickname();
  const myData = userStats[myName] || { ev: 0, actual: 0 };
  const myActual = myData.actual;
  
  const avatarIcon = document.getElementById('avatar-icon');
  const avatarMsg = document.getElementById('avatar-msg');
  const avatarContainer = document.getElementById('avatar-container');

  if (myActual >= 50000) {
    avatarIcon.innerHTML = "✨🦝🦊✨"; 
    avatarMsg.innerHTML = "5万円以上勝ち！<br>金色のたぬきときつね";
    avatarContainer.style.borderColor = "#f1c40f";
  } else if (myActual >= 10000) {
    avatarIcon.innerHTML = "🍗🦝🔥🦊🍖"; 
    avatarMsg.innerHTML = "1万円以上勝ち！<br>焼肉してるたぬきときつね";
    avatarContainer.style.borderColor = "#e67e22";
  } else if (myActual <= -50000) {
    avatarIcon.innerHTML = "📦🦝🦊📦"; 
    avatarMsg.innerHTML = "5万円以上負け...<br>段ボールに入っているたぬきときつね";
    avatarContainer.style.borderColor = "#34495e";
  } else if (myActual <= -10000) {
    avatarIcon.innerHTML = "🌱🦝🦊🌱"; 
    avatarMsg.innerHTML = "1万円以上負け...<br>もやし持ってるたぬきときつね";
    avatarContainer.style.borderColor = "#95a5a6";
  } else {
    avatarIcon.innerHTML = "🦝🦊"; 
    avatarMsg.innerHTML = "プラマイゼロ<br>棒立ちのたぬきときつね";
    avatarContainer.style.borderColor = "var(--border-color)";
  }

  // 2. ユーザー配列の作成
  let users = Object.keys(userStats).map(name => {
    return { name: name, ev: userStats[name].ev, actual: userStats[name].actual, diff: userStats[name].actual - userStats[name].ev };
  });

  // ページ1: 収支ランキング（実収支降順）
  users.sort((a, b) => b.actual - a.actual);
  let html1 = "";
  if (users.length > 0) {
    html1 += `<div style="font-size:18px; font-weight:bold; color:#f39c12; margin-bottom:10px;">👑 月間MVP: ${users[0].name} <span style="font-size:14px; color:#555;">(${formatCurrency(users[0].actual)})</span></div>`;
    if (users.length > 1) {
      let last = users[users.length - 1];
      html1 += `<div style="font-size:15px; font-weight:bold; color:#34495e; margin-bottom:15px;">💸 今月の養分: ${last.name} <span style="font-size:13px; color:#555;">(${formatCurrency(last.actual)})</span></div>`;
    }
    html1 += `<table style="width:100%; border-collapse:collapse; font-size:13px;">`;
    users.forEach((u, i) => {
      html1 += `<tr style="border-bottom:1px dashed var(--border-color);">
        <td style="padding:8px 0; font-weight:bold; color:var(--text-sub); width:40px;">${i+1}位</td>
        <td style="font-weight:bold;">${u.name}</td>
        <td style="text-align:right; font-weight:bold; color:${u.actual >= 0 ? '#2980b9' : '#e74c3c'}">${formatCurrency(u.actual)}</td>
      </tr>`;
    });
    html1 += `</table>`;
  } else { html1 = "<div style='text-align:center; color:var(--text-muted); font-size:12px;'>稼働データがありません</div>"; }
  document.getElementById('rank-content-1').innerHTML = html1;

  // ページ2: ヒキランキンググラフ（乖離額降順）
  users.sort((a, b) => b.diff - a.diff);
  let labels = users.map(u => u.name);
  let evData = users.map(u => u.ev);
  let actualData = users.map(u => u.actual);

  if(window.hikiChartInstance) window.hikiChartInstance.destroy();
  window.hikiChartInstance = new Chart(document.getElementById('hikiChart'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { label: '期待値', data: evData, backgroundColor: '#3498db', borderRadius: 4 },
        { label: '実収支', data: actualData, backgroundColor: '#e74c3c', borderRadius: 4 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } } } }
  });

  // ページ3: 貢献度ドーナツグラフ
  let posUsers = users.filter(u => u.actual > 0);
  if(window.pieChartInstance) window.pieChartInstance.destroy();
  if(posUsers.length > 0) {
    document.getElementById('pieChartContainer').style.display = 'block';
    document.getElementById('noPieData').style.display = 'none';
    let pieLabels = posUsers.map(u => u.name);
    let pieData = posUsers.map(u => u.actual);
    window.pieChartInstance = new Chart(document.getElementById('pieChart'), {
      type: 'doughnut',
      data: {
        labels: pieLabels,
        datasets: [{ data: pieData, backgroundColor: ['#f1c40f', '#2ecc71', '#e67e22', '#9b59b6', '#3498db'], borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } } }, cutout: '65%' }
    });
  } else {
    document.getElementById('pieChartContainer').style.display = 'none';
    document.getElementById('noPieData').style.display = 'block';
  }
}

window.deleteCalendarDay = async function(date) {
  if (!isAdmin) return alert("権限がありません。");
  if(confirm(`${date} の記録をすべて削除しますか？`)) { const cal = await getCalendarData(); delete cal[date]; await saveCalendarData(cal); renderCalendar(); }
};

window.renderHistoryTab = async function() {
  const records = await getRecordsData(), container = document.getElementById('historyRecordsContainer'), filterText = document.getElementById('historyMachineFilter').value.trim();
  const today = new Date(), oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  let filtered = records.filter(r => { if (!r.date) return false; if (new Date(r.date) < oneYearAgo) return false; if (filterText && r.machine && !r.machine.includes(filterText)) return false; return true; });
  if (filtered.length === 0) return container.innerHTML = '<p style="font-size:13px; color:var(--text-muted);">条件に一致する過去1年間のデータはありません。</p>';
  filtered.sort((a, b) => new Date(b.date) - new Date(a.date)); let html = ''; filtered.forEach(r => { html += createRecordItemHtml(r); }); container.innerHTML = html;
};
