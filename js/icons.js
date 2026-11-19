// Lucide icons for the buttons: one module per icon (only these are fetched), not the whole set or an icon font.
// A button opts in with data-icon="name"; its text moves into a .label span next to the icon.
import createElement from 'lucide/createElement.mjs';
import Box from 'lucide/icons/box.mjs';
import Copy from 'lucide/icons/copy.mjs';
import Download from 'lucide/icons/download.mjs';
import Eraser from 'lucide/icons/eraser.mjs';
import FileInput from 'lucide/icons/file-input.mjs';
import Link from 'lucide/icons/link.mjs';
import Paintbrush from 'lucide/icons/paintbrush.mjs';
import Play from 'lucide/icons/play.mjs';
import Plus from 'lucide/icons/plus.mjs';
import RefreshCw from 'lucide/icons/refresh-cw.mjs';
import RotateCcw from 'lucide/icons/rotate-ccw.mjs';
import RotateCw from 'lucide/icons/rotate-cw.mjs';
import Send from 'lucide/icons/send.mjs';
import Settings from 'lucide/icons/settings.mjs';
import Shuffle from 'lucide/icons/shuffle.mjs';
import StepBack from 'lucide/icons/step-back.mjs';
import StepForward from 'lucide/icons/step-forward.mjs';
import Trash from 'lucide/icons/trash.mjs';
import Undo2 from 'lucide/icons/undo-2.mjs';
import Upload from 'lucide/icons/upload.mjs';
import WandSparkles from 'lucide/icons/wand-sparkles.mjs';

const ICONS = {
  'box': Box,
  'copy': Copy,
  'download': Download,
  'eraser': Eraser,
  'file-input': FileInput,
  'link': Link,
  'paintbrush': Paintbrush,
  'play': Play,
  'plus': Plus,
  'refresh-cw': RefreshCw,
  'rotate-ccw': RotateCcw,
  'rotate-cw': RotateCw,
  'send': Send,
  'settings': Settings,
  'shuffle': Shuffle,
  'step-back': StepBack,
  'step-forward': StepForward,
  'trash': Trash,
  'undo-2': Undo2,
  'upload': Upload,
  'wand-sparkles': WandSparkles,
};

/** Put the icon in front of every button[data-icon] under `root` (once per button). */
export function decorate(root = document) {
  for (const b of root.querySelectorAll('button[data-icon]')) {
    if (b.querySelector('.label')) continue;
    const node = ICONS[b.dataset.icon];
    if (!node) continue;
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = b.textContent.trim();
    const svg = createElement(node, { class: 'icon', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false' });
    b.replaceChildren(svg, label);
  }
}

/** Change a button's text without dropping its icon. */
export function setLabel(button, text) {
  (button.querySelector('.label') ?? button).textContent = text;
}
