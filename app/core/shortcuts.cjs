function isDeleteKey(event, platform) {
  return event.key === 'Delete' || (platform === 'darwin' && event.key === 'Backspace');
}
module.exports = { isDeleteKey };
