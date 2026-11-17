const progressBar = document.querySelector("#progress-bar");
const progressText = document.querySelector("#progress-text");

const targetProgress = 75;

window.requestAnimationFrame(() => {
  progressBar.style.width = `${targetProgress}%`;
  progressText.textContent = `${targetProgress}%`;
});
