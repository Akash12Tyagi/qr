// Runs before first paint (classic script in <head>) so the saved theme never flashes.
try {
  var t = localStorage.getItem('qm:theme');
  document.documentElement.dataset.theme = t ? JSON.parse(t) : 'light';
} catch (e) {
  document.documentElement.dataset.theme = 'light';
}
