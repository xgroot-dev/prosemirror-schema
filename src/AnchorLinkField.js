import { Field } from './Field';

// A single-line link field with an anchor autocomplete. Behaves exactly like a
// plain text input for URLs, but while the typed value is NOT clearly a URL
// (doesn't start with http(s)://, //, mailto: or tel:) and the document has
// named anchors, it shows a filtered dropdown of those anchors. Picking one
// sets the value to `#<name>`. When the document has no anchors it is
// indistinguishable from a plain TextField, so the message editor's link prompt
// is unaffected.
//
// options.anchors: string[] — anchor names collected from the current document.
const URL_LIKE_RE = /^(https?:)?\/\//i;
const SCHEME_RE = /^(mailto:|tel:)/i;

const isUrlLike = value => {
  const v = (value || '').trim();
  return URL_LIKE_RE.test(v) || SCHEME_RE.test(v);
};

// The fragment the user is trying to match: strip a leading '#'.
const matchTerm = value => (value || '').trim().replace(/^#/, '').toLowerCase();

export class AnchorLinkField extends Field {
  render() {
    const anchors = Array.isArray(this.options.anchors)
      ? this.options.anchors
      : [];

    const wrapper = document.createElement('div');
    wrapper.className = 'cw-anchor-link-field';
    wrapper.style.position = 'relative';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = this.options.label;
    input.className = this.options.class;
    input.value = this.options.value || '';
    input.autocomplete = 'off';
    wrapper.appendChild(input);

    const list = document.createElement('ul');
    list.className = 'cw-anchor-suggestions';
    list.style.display = 'none';
    wrapper.appendChild(list);

    // No anchors in the document -> behave as a plain text field.
    if (!anchors.length) return wrapper;

    let activeIndex = -1;
    let visible = [];

    const hide = () => {
      list.style.display = 'none';
      list.innerHTML = '';
      activeIndex = -1;
      visible = [];
    };

    const applyActive = () => {
      Array.from(list.children).forEach((li, i) => {
        li.classList.toggle('is-active', i === activeIndex);
      });
    };

    const choose = name => {
      input.value = `#${name}`;
      hide();
      input.focus();
    };

    const refresh = () => {
      if (isUrlLike(input.value)) {
        hide();
        return;
      }
      const term = matchTerm(input.value);
      visible = anchors.filter(name =>
        term ? name.toLowerCase().includes(term) : true
      );
      if (!visible.length) {
        hide();
        return;
      }
      list.innerHTML = '';
      visible.forEach((name, i) => {
        const li = document.createElement('li');
        li.className = 'cw-anchor-suggestion';
        li.textContent = `#${name}`;
        // mousedown (not click) + preventDefault keeps focus on the input so the
        // prompt doesn't treat it as a blur/outside interaction.
        li.addEventListener('mousedown', e => {
          e.preventDefault();
          choose(name);
        });
        li.addEventListener('mouseenter', () => {
          activeIndex = i;
          applyActive();
        });
        list.appendChild(li);
      });
      activeIndex = -1;
      applyActive();
      list.style.display = 'block';
    };

    input.addEventListener('input', refresh);
    input.addEventListener('focus', refresh);

    input.addEventListener('keydown', e => {
      const isOpen = list.style.display !== 'none';
      if (e.key === 'ArrowDown' && isOpen) {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, visible.length - 1);
        applyActive();
      } else if (e.key === 'ArrowUp' && isOpen) {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        applyActive();
      } else if (e.key === 'Enter' && isOpen && activeIndex >= 0) {
        // Pick the highlighted anchor instead of submitting the prompt.
        e.preventDefault();
        e.stopPropagation();
        choose(visible[activeIndex]);
      } else if ((e.key === 'Escape' || e.key === 'Esc') && isOpen) {
        // Close the dropdown first; keep the prompt open.
        e.preventDefault();
        e.stopPropagation();
        hide();
      }
    });

    return wrapper;
  }

  // The field's DOM is a wrapper; the value lives on the nested input.
  read(dom) {
    const input = dom.querySelector('input');
    return input ? input.value : '';
  }
}
