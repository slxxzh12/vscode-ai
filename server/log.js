export function createLogger(prefix = '') {
  const ts = () => new Date().toISOString();
  return {
    info: (...a) => console.log(ts(), prefix, ...a),
    warn: (...a) => console.warn(ts(), prefix, '[warn]', ...a),
    error: (...a) => console.error(ts(), prefix, '[error]', ...a),
  };
}
