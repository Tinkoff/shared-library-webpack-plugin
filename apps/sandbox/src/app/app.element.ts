import * as minimatch from 'minimatch';
import * as _ from 'lodash';

export class AppElement extends HTMLElement {
  public static observedAttributes = [];

  connectedCallback() {
    this.innerHTML = `
     <div>minimatch('lodash/*', 'lodash/step') -> <span class="minimatch-message">${minimatch(
       'lodash/*',
       'lodash/step'
     )}</span></div>
     <div>_.camelCase('shared-library-webpack-plugin') -> <span class="lodash-message">${_.camelCase(
       'shared-library-webpack-plugin'
     )}</span></div>
    `;
  }
}

customElements.define('shared-library-webpack-plugin-root', AppElement);
