// Public sign-in interface only. Hidden brand glyphs cannot satisfy localization.
export function installHindiInterfaceProbe() {
  window.__VYAKTI_HINDI_INTERFACE__ = () => {
    const root = document.querySelector('main[data-studio-auth-locale="hi"][lang="hi"]');
    if (!root) return false;
    const visible = element => {
      if (!element || element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
      // Rendered CSS visibility, not just a Devanagari codepoint in the DOM.
      // This bounded Hindi-only query may flush style; budgets remain unchanged.
      return typeof element.checkVisibility === 'function'
        && element.checkVisibility({checkOpacity:true, checkVisibilityCSS:true});
    };
    const visibleHindi = element => {
      if (!visible(element)) return false;
      const walker = document.createTreeWalker(element, 4 /* SHOW_TEXT */);
      let node, examined = 0;
      while ((node = walker.nextNode()) && examined++ < 64) {
        if (/[\u0900-\u097f]/.test(node.nodeValue || '') && visible(node.parentElement)) return true;
      }
      return false;
    };
    const label = root.querySelector('label[for="studio-email"], label[for="studio-code"]');
    const control = label?.control;
    return !!control && root.contains(control) && control.tagName === 'INPUT'
      && ['studio-email', 'studio-code'].includes(control.id)
      && label.htmlFor === control.id && control.type !== 'hidden'
      && (control.id === 'studio-email' ? control.type === 'email' : control.type === 'text' && control.inputMode === 'numeric')
      && !control.disabled && !control.readOnly && visible(control)
      && visibleHindi(root.querySelector('#signin-title')) && visibleHindi(label);
  };
}
