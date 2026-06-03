type TvKeyboardState = {
  visible: boolean;
  value: string;
  onChange: (val: string) => void;
  onConfirm: () => void;
  label?: string;
  maxLength?: number;
};

type Listener = (state: TvKeyboardState) => void;

const DEFAULT: TvKeyboardState = {
  visible: false,
  value: '',
  onChange: () => {},
  onConfirm: () => {},
};

let state: TvKeyboardState = { ...DEFAULT };
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach(fn => fn({ ...state }));
}

export const tvKeyboardStore = {
  getState: () => ({ ...state }),

  subscribe: (fn: Listener) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  open: (opts: { value: string; onChange: (v: string) => void; onConfirm: () => void; label?: string; maxLength?: number }) => {
    state = { visible: true, ...opts };
    notify();
  },

  close: () => {
    state = { ...DEFAULT };
    notify();
  },

  setValue: (value: string) => {
    state = { ...state, value };
    notify();
    state.onChange(value);
  },
};
