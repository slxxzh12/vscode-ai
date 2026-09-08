export function makeFakePty() {
  const handlers = { data: [], exit: [] };
  const pty = {
    pid: Math.floor(Math.random() * 1e6),
    shell: 'unix',
    writes: [],
    onData(cb) { handlers.data.push(cb); },
    onExit(cb) { handlers.exit.push(cb); },
    write(s) { pty.writes.push(String(s)); },
    resize() {}, kill() {},
    __emitData(chunk) { for (const cb of handlers.data.slice()) cb(String(chunk)); },
    __emitExit(code) { for (const cb of handlers.exit.slice()) cb(code === undefined ? 0 : code); },
  };
  return pty;
}
export function makeFakePtyFactory(collector) {
  const instances = collector || [];
  return ({ cwd, cols, rows }) => {
    const p = makeFakePty();
    instances.push({ pty: p, cwd, cols, rows });
    return p;
  };
}
