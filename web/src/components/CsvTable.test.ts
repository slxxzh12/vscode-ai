// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import CsvTable from './CsvTable.vue';

describe('CsvTable', () => {
  it('renders CSV as an Element Plus table', async () => {
    const w = mountC(CsvTable, {
      props: { text: 'name,age\nAlice,30\nBob,25' },
      global: { plugins: [ElementPlus] },
    });
    await flushPromises();
    const rows = w.findAll('.el-table__row');
    expect(rows.length).toBe(2);
    expect(w.text()).toContain('name');
    expect(rows[0].text()).toContain('Alice');
    expect(rows[0].text()).toContain('30');
  });
});
