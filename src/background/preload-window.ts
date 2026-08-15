export function pickerPreloadWindowOptions(
  pickerUri: string,
): chrome.windows.CreateData {
  return {
    url: pickerUri,
    type: 'popup',
    focused: false,
    state: 'minimized',
  }
}
