// Node のバージョン比較。OpenPipes は node:sqlite を static import するので、古い Node では
// 分かりにくい import エラーになる。その前にランチャーが自分の言葉で止めるための小さな道具。
export const MIN_NODE = '22.13.0';

// 'v24.19.0' や '22.13.0' を [24, 19, 0] に。読めなければ null
export function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function meetsMinimum(version, minimum = MIN_NODE) {
  const a = parseVersion(version);
  const b = parseVersion(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}
