/*
 * Showcase playground configuration - one demo per component
 *
 * Each entry describes how the showcase (docs/showcase/index.js) builds a single
 * live preview and the attribute table beside it:
 *   - slot / inner : the markup rendered inside the component (label text or
 *                    the required children, e.g. a select's options)
 *   - trigger      : true when the component is opened from a trigger it
 *                    already contains (overlays)
 *   - controls     : the attributes shown in the table, in order. Every
 *                    option renders at once as a clickable badge (text
 *                    attributes as an editable field); picking or typing one
 *                    updates the preview and the snippet.
 *   - defaults     : starting values that differ from the documented default
 *   - aliases      : map a control onto a differently-named attribute
 *   - note         : a hint shown under the table
 *
 * Anything not listed here is documented on /api but not given a live
 * playground - see NO_PANEL at the bottom. To add a demo for a new
 * component, add an entry keyed by its tag.
 */

import { jellyIcon } from '../../package.js';

// The documented fill variants, shared by every variant control
const VARIANTS = ['azure', 'rose', 'amber', 'mint', 'graphite', 'platinum', 'white'];

// The density scale, shared by every size control
const SIZES = ['small', 'medium', 'large'];

// Control shorthands so the configs below stay readable
const bool   = (attr) => ({ attr, kind: 'bool' });

const size   = () => ({ attr: 'size', kind: 'enum', options: SIZES });

const variant = () => ({ attr: 'variant', kind: 'enum', options: VARIANTS });

const pick   = (attr, options) => ({ attr, kind: 'enum', options });

// A number control shown as an editable spinner (clamped to min/max)
const numField = (attr, min, max, step = 1) => ({ attr, kind: 'number', min, max, step, field: true });

// A free-typed text control: an editable field whose value lands on the preview
const text   = (attr, placeholder = '') => ({ attr, kind: 'text', placeholder });

export const PLAYGROUNDS = {

  /* ---- Theming ---- */

  'jelly-theme': {
    // A roomy mini settings panel shows surface/text theming plus several
    // controls that inherit --jelly-color-background-accent.
    inner: '<jelly-card style="padding: 26px; min-width: 320px;"><div style="display: grid; gap: 24px; justify-items: stretch;"><div style="display: grid; gap: 4px;"><strong style="font-size: 16px;">Workspace controls</strong><span style="font-size: 13px; opacity: 0.68;">Preview the scoped theme</span></div><jelly-slider label="Volume" value="62" style="width: 100%;"></jelly-slider><jelly-progress label="Completion" value="62" style="width: 100%;"></jelly-progress><div style="display: flex; flex-wrap: wrap; align-items: center; gap: 14px 20px;"><jelly-checkbox checked>Sync</jelly-checkbox><jelly-switch checked>Notifications</jelly-switch></div></div></jelly-card>',

    controls: [pick('mode', ['auto', 'light', 'dark']), text('accent', '#7C3AED')],

    defaults: { mode: 'auto' },
  },

  /* ---- Actions ---- */

  'jelly-button': {
    slot: 'Publish',

    controls: [variant(), size(), pick('shape', ['pill', 'square']), bool('disabled'), bool('block')],

    // "pill" (the default) clears the attribute; "square" sets shape="square"
    aliases: { shape: { attr: 'shape', off: 'pill' } },

    defaults: { shape: 'pill' },
  },

  'jelly-icon-button': {
    // A Fluent star (from the library's inline icon set) as the icon
    inner: jellyIcon('star', { size: 20 }),

    controls: [variant(), size(), pick('shape', ['square', 'circle']), bool('disabled'), text('label', 'Accessible name')],

    defaults: { shape: 'square' },
  },

  /* ---- Forms ---- */

  'jelly-input': {
    attrs: { label: 'Example input' },

    controls: [
      text('placeholder', 'Placeholder'),

      text('value', 'Type here'),

      pick('type', ['text', 'email', 'password']),

      size(),

      bool('disabled'),

      bool('readonly'),
    ],

    bind: [{ event: 'input', attr: 'value', get: (el) => el.value }],

    defaults: { placeholder: 'Your name' },
  },

  'jelly-textarea': {
    attrs: { label: 'Example note' },

    controls: [text('placeholder', 'Placeholder'), text('value', 'Type here'), numField('rows', 2, 8), size(), bool('disabled'), bool('readonly')],

    bind: [{ event: 'input', attr: 'value', get: (el) => el.value }],

    defaults: { placeholder: 'Write a note…' },
  },

  'jelly-checkbox': {
    slot: 'Subscribe to updates',

    controls: [bool('checked'), bool('indeterminate'), variant(), size(), bool('disabled')],

    bind: [{ event: 'change', attr: 'checked', get: (el) => el.checked }],
  },

  'jelly-radio': {
    slot: 'Wireless',

    controls: [bool('checked'), variant(), size(), bool('disabled')],

    bind: [{ event: 'change', attr: 'checked', get: (el) => el.checked }],

    defaults: { checked: true },
  },

  'jelly-radio-group': {
    inner: '<jelly-radio name="pg-plan" value="free" checked>Free</jelly-radio><jelly-radio name="pg-plan" value="pro">Pro</jelly-radio><jelly-radio name="pg-plan" value="team">Team</jelly-radio>',

    controls: [pick('direction', ['horizontal', 'vertical']), size(), text('label', 'Group label')],
  },

  'jelly-switch': {
    slot: 'Notifications',

    controls: [bool('checked'), variant(), size(), bool('disabled')],

    bind: [{ event: 'change', attr: 'checked', get: (el) => el.checked }],
  },

  'jelly-slider': {
    attrs: { label: 'Value' },

    controls: [numField('value', 0, 100), numField('min', 0, 100), numField('max', 0, 100), numField('step', 1, 25), variant(), size(), bool('disabled')],

    bind: [{ event: 'input', attr: 'value', get: (el) => el.value }],

    defaults: { value: 50, min: 0, max: 100, step: 1 },
  },

  'jelly-range': {
    attrs: { label: 'Interval' },

    controls: [numField('low', 0, 100), numField('high', 0, 100), numField('min', 0, 100), numField('max', 0, 100), numField('step', 1, 25), variant(), size(), bool('disabled')],

    bind: [{ event: 'input', attr: 'low', get: (el) => el.value.split(',')[0] },

           { event: 'input', attr: 'high', get: (el) => el.value.split(',')[1] }],

    defaults: { low: 25, high: 75, min: 0, max: 100, step: 1 },
  },

  'jelly-select': {
    attrs: { label: 'Fruit' },

    inner: '<jelly-option value="kiwi">Kiwi</jelly-option><jelly-option value="fig">Fig</jelly-option><jelly-option value="plum">Plum</jelly-option>',

    controls: [pick('value', ['kiwi', 'fig', 'plum']), variant(), size(), bool('disabled')],

    bind: [{ event: 'change', attr: 'value', get: (el) => el.value }],

    defaults: { value: 'kiwi' },
  },

  'jelly-segmented': {
    attrs: { label: 'Period' },

    inner: '<jelly-segment value="day">Day</jelly-segment><jelly-segment value="week">Week</jelly-segment><jelly-segment value="month">Month</jelly-segment>',

    controls: [pick('value', ['day', 'week', 'month']), size(), bool('disabled')],

    bind: [{ event: 'change', attr: 'value', get: (el) => el.value }],

    defaults: { value: 'week' },
  },

  'jelly-otp': {
    attrs: { label: 'Verification code' },

    controls: [numField('length', 4, 8), variant(), size(), bool('disabled')],

    defaults: { length: 6 },
  },

  'jelly-label': {
    slot: 'Email address',

    inner: 'Email address',

    controls: [bool('required'), size()],
  },

  /* ---- Feedback ---- */

  'jelly-alert': {
    slot: 'Your changes are live.',

    controls: [pick('tone', ['info', 'success', 'warning', 'danger']), bool('dismissible'), size()],

    defaults: { tone: 'success' },
  },

  'jelly-badge': {
    slot: '7',

    controls: [variant(), size(), bool('outline'), pick('shape', ['pill', 'square']), bool('live'), bool('instant')],

    // "pill" (the default) clears the attribute; "square" sets shape="square"
    aliases: { shape: { attr: 'shape', off: 'pill' } },

    defaults: { variant: 'rose', shape: 'pill' },
  },

  'jelly-progress': {
    attrs: { label: 'Completion' },

    controls: [numField('value', 0, 100), numField('max', 1, 100), bool('indeterminate'), variant(), size()],

    defaults: { value: 60, max: 100 },
  },

  'jelly-spinner': {
    controls: [pick('type', ['blob', 'dots']), variant(), size()],
  },

  'jelly-skeleton': {
    controls: [pick('shape', ['line', 'rect', 'circle'])],

    defaults: { shape: 'line' },
  },

  'jelly-toaster': {
    trigger: true,

    // the trigger sits beside the (invisible) toaster rail, not inside it
    extra: '<jelly-button data-toast variant="mint">Show a toast</jelly-button>',

    controls: [pick('tone', ['info', 'success', 'warning', 'danger'])],

    defaults: { tone: 'success' },

    note: 'Fires jellyToast() with the chosen tone. Add position="bottom" on a placed <jelly-toaster> to grow the stack upward.',
  },

  /* ---- Surfaces ---- */

  'jelly-card': {
    inner: '<h3 style="margin:0 0 6px">Soft surface</h3><p style="margin:0">The jelly stays under the content.</p>',

    controls: [bool('squish'), size()],
  },

  'jelly-chip': {
    slot: 'Design',

    // variant + size step first, while the chip is still selected (a chip only
    // shows its variant hue when selected), then the boolean toggles run
    controls: [variant(), size(), pick('shape', ['pill', 'square']), bool('selectable'), bool('selected'), bool('removable'), bool('disabled')],

    // "pill" (the default) clears the attribute; "square" sets shape="square"
    aliases: { shape: { attr: 'shape', off: 'pill' } },

    bind: [{ event: 'change', attr: 'selected', get: (el) => el.selected }],

    defaults: { selectable: true, selected: true, shape: 'pill' },
  },

  'jelly-kbd': {
    slot: 'K',

    controls: [text('key', 'Physical key (e.g. k)'), size()],

    note: 'Set key and hold that key anywhere on the page - the cap depresses with it.',
  },

  'jelly-divider': {
    inner: 'or',

    wrap: 'block',

    controls: [pick('direction', ['horizontal', 'vertical']), text('content', 'Label'), size()],

    // "horizontal" is the default (attribute absent); only "vertical" sets it
    aliases: { direction: { attr: 'direction', off: 'horizontal' } },

    defaults: { content: 'or' },
  },

  'jelly-collapsible': {
    inner: '<span slot="header">What moves?</span>The surface, not the text.',

    controls: [bool('open'), size()],

    bind: [{ event: 'toggle', attr: 'open', get: (el) => el.open }],

    defaults: { open: true },
  },

  'jelly-accordion': {
    inner: '<jelly-collapsible open><span slot="header">Motion</span>Soft and contained.</jelly-collapsible><jelly-collapsible><span slot="header">Forms</span>Native and composed.</jelly-collapsible>',

    controls: [bool('single'), size()],
  },

  /* ---- Navigation ---- */

  'jelly-tabs': {
    inner: [
      '<jelly-tab-panel label="Overview" value="overview" active>',

        '<div class="pg-tab"><h3>Overview</h3><p>A calm summary of where the project stands and what shipped this week.</p></div>',

      '</jelly-tab-panel>',

      '<jelly-tab-panel label="Activity" value="activity">',

        '<div class="pg-tab"><h3>Activity</h3><p>Ada deployed v2.1 · Grace opened 3 pull requests · 12 issues closed.</p></div>',

      '</jelly-tab-panel>',

      '<jelly-tab-panel label="Settings" value="settings">',

        '<div class="pg-tab"><h3>Settings</h3><p>Theme, notifications and workspace preferences live here.</p></div>',

      '</jelly-tab-panel>',
    ].join(''),

    controls: [pick('value', ['overview', 'activity', 'settings']), size()],

    bind: [{ event: 'change', attr: 'value', get: (el) => el.value }],

    defaults: { value: 'overview' },
  },

  'jelly-breadcrumbs': {
    inner: '<a href="#pg">Home</a><a href="#pg">Library</a><span>Switch</span>',

    controls: [size()],
  },

  'jelly-pagination': {
    controls: [numField('total', 3, 20), numField('page', 1, 20), size()],

    bind: [{ event: 'change', attr: 'page', get: (el) => el.page }],

    defaults: { total: 12, page: 3 },
  },

  'jelly-resizable': {
    // Each pane is a solid surface tile so the split reads clearly
    inner: '<div class="pg-pane">One</div><div class="pg-pane">Two</div><div class="pg-pane">Three</div>',

    wrap: 'fill',

    controls: [pick('direction', ['row', 'vertical', 'both'])],

    // "row" is the default (attribute absent)
    aliases: { direction: { attr: 'direction', off: 'row' } },
  },

  /* ---- Overlays ---- */

  'jelly-tooltip': {
    inner: `<jelly-icon-button label="Copy">${jellyIcon('link', { size: 18 })}</jelly-icon-button>`,

    controls: [text('text', 'Tooltip text'), pick('placement', ['top', 'bottom', 'start', 'end']), size()],

    defaults: { text: 'Copy link' },

    note: 'Hover or focus the button to reveal the tooltip.',
  },

  'jelly-popover': {
    trigger: true,

    inner: '<jelly-button slot="trigger">Options</jelly-button><div slot="content">Anything can live in a popover.</div>',

    controls: [pick('placement', ['top', 'bottom', 'start', 'end']), size(), text('label', 'Accessible name')],

    defaults: { placement: 'bottom' },

    note: 'Click the trigger to open.',
  },

  'jelly-menu': {
    trigger: true,

    inner: '<jelly-button slot="trigger">Actions</jelly-button><jelly-menu-item value="edit">Edit</jelly-menu-item><jelly-menu-item value="duplicate">Duplicate</jelly-menu-item><jelly-menu-item value="delete" danger>Delete</jelly-menu-item>',

    controls: [pick('placement', ['top', 'bottom', 'start', 'end']), size()],

    defaults: { placement: 'bottom' },

    note: 'Click the trigger to open the menu.',
  },

  'jelly-dialog': {
    trigger: true,

    extra: '<jelly-button data-open variant="mint">Open dialog</jelly-button>',

    inner: '<h2 style="margin:0 0 8px">Confirm</h2><p style="margin:0">Escape, the ✕, or the backdrop closes me.</p>',

    controls: [text('label', 'Accessible name')],

    note: 'Click to open the modal dialog.',
  },

  'jelly-drawer': {
    trigger: true,

    extra: '<jelly-button data-open variant="mint">Open drawer</jelly-button>',

    inner: '<h3 style="margin:0 0 8px">Navigation</h3><p style="margin:0">I slide in from the chosen side.</p>',

    controls: [pick('side', ['end', 'start', 'bottom']), text('label', 'Accessible name')],

    defaults: { side: 'end' },

    note: 'Click to open the drawer.',
  },

};

// Tags documented on /api but not given a standalone playground: the
// child-only elements (they appear inside their parents' demos above) and
// jelly-theme (a wrapper with nothing of its own to look at)
export const NO_PANEL = new Set(['jelly-option', 'jelly-segment', 'jelly-menu-item', 'jelly-tab-panel']);
