// 手机页入口判定：URL 查询串里 phone=1 就走 PhoneView（不加载主界面、不连终端 WS）。
export function isPhoneEntry(search: string): boolean {
  const query = String(search || '').split('#')[0];
  return new URLSearchParams(query).get('phone') === '1';
}
