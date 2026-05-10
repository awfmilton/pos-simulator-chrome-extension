const { performance } = require('perf_hooks');

const posUrlPattern = "https://example.com/pos/*";
const tabs = [];
for (let i = 0; i < 10000; i++) {
  tabs.push({ url: `https://example.com/other/${i}`, id: i });
}

function runInsideLoop() {
  const start = performance.now();
  let connectedTab = null;
  for (let j = 0; j < 1000; j++) {
      for (const tab of tabs) {
        if (tab.url && tab.url.match(new RegExp(posUrlPattern.replace('*', '.*')))) {
          connectedTab = tab;
          break;
        }
      }
  }
  const end = performance.now();
  return end - start;
}

function runOutsideLoop() {
  const start = performance.now();
  let connectedTab = null;
  for (let j = 0; j < 1000; j++) {
      const regex = new RegExp(posUrlPattern.replace('*', '.*'));
      for (const tab of tabs) {
        if (tab.url && tab.url.match(regex)) {
          connectedTab = tab;
          break;
        }
      }
  }
  const end = performance.now();
  return end - start;
}

const inside = runInsideLoop();
const outside = runOutsideLoop();

console.log(`Inside loop: ${inside.toFixed(2)}ms`);
console.log(`Outside loop: ${outside.toFixed(2)}ms`);
console.log(`Improvement: ${((inside - outside) / inside * 100).toFixed(2)}%`);
