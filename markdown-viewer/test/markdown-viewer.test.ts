import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import MarkdownViewer from '../src/vue/MarkdownViewer.vue';

describe('MarkdownViewer', () => {
  it('renders markdown content', async () => {
    const wrapper = mount(MarkdownViewer, { props: { content: '# hi' } });
    await new Promise((r) => setTimeout(r, 30));
    expect(wrapper.find('.mdv-body').html()).toContain('<h1>hi</h1>');
  });
});
