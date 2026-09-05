self.addEventListener('message', function(e) {
  const data = e.data;
  // data = { R: 回転率, E: 交換率, M: 持ち球比率, totalSpins: 総回転, P: 初当たり確率, E_out: 実測平均出玉 }
  
  // 1回転あたりのコスト（貸玉4.0円、持ち玉は交換率で換算）
  const costPerSpin = (250 / data.R) * (data.M * data.E + (1 - data.M) * 4.0);
  // 1回転あたりの回収
  const returnPerSpin = (data.E_out / data.P) * data.E;
  
  // 1回転あたりの単価とトータル期待値（仕事量）
  const evSpin = returnPerSpin - costPerSpin;
  const totalEV = evSpin * data.totalSpins;

  // ブレシミュレーション用
  const hitProb = 1 / data.P;
  const meanHits = data.totalSpins * hitProb;
  const stdDevHits = Math.sqrt(data.totalSpins * hitProb * (1 - hitProb));
  
  let results = [];
  // スマホをフリーズさせずに裏で10万回計算
  for (let i = 0; i < 100000; i++) {
    let u1 = 1 - Math.random(); let u2 = 1 - Math.random(); 
    let z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    let simulatedHits = Math.max(0, meanHits + z * stdDevHits);
    results.push((simulatedHits * data.E_out * data.E) - (costPerSpin * data.totalSpins));
  }
  
  results.sort((a, b) => a - b);
  
  // アプリ側に計算結果を返す
  self.postMessage({
    totalEV: totalEV,
    evSpin: evSpin,
    simBot5: results[5000],
    simBot25: results[25000],
    simMedian: results[50000],
    simTop25: results[75000],
    simTop5: results[95000]
  });
});
