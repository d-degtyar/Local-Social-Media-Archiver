// The only script on the guide: copy the tag name for Eagle's smart folder rule.
const button = document.querySelector('#copy-tag');
button.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText('Main Cover');
    button.textContent = 'Copied ✓';
  } catch {
    button.textContent = 'Select and copy: Main Cover';
  }
  setTimeout(() => { button.textContent = 'Copy tag'; }, 2000);
});
