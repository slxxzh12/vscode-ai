import { t } from '../../i18n';

const ERROR_KEY: Record<string, string> = {
  'port-in-use': 'nginx.err_port_in_use',
  'bad-request': 'nginx.err_bad_prefix',
  'bad-rewrite': 'nginx.err_bad_rewrite',
  'not-found': 'nginx.err_not_found',
};

export function nginxErrText(e: unknown) {
  const c = (e as Error)?.message || '';
  return ERROR_KEY[c] ? t(ERROR_KEY[c]) : c;
}
