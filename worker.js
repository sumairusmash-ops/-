self.addEventListener('message', function(e) {
  const data = e.data;
  const expectedReturn = (250 * data.E) / data.B;
  const actualCost = ((250 * data.E * data.M) / data.R) + ((1000 * (1 - data.M)) / data.R);
  const evSpin = expectedReturn - actualCost;
  const totalEV = evSpin * data.totalSpins;

  const hitProb = 1 / data.probDenom;
  const meanHits = data.totalSpins * hitProb;
  const stdDevHits = Math.sqrt(data.totalSpins * hitProb * (1 - hitProb));
  
  let results = [];
  // 10万回シミュレーション（別ファイルなのでスマホがフリーズしません）
  for (let i = 0; i < 100000; i++) {
    let u1 = 1 - Math.random(); let u2 = 1 - Math.random(); 
    let z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    let simulatedHits = Math.max(0, meanHits + z * stdDevHits);
    results.push((simulatedHits * data.avgPayout * data.E) - (actualCost * data.totalSpins));
  }
  
  results.sort((a, b) => a - b);
  
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
