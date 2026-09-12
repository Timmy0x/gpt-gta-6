import type { StreamedMiamiVisuals, VisualSnapshot } from '../world/miami/visuals/StreamedMiamiVisuals';
import { renderCredits } from './SourceCredits';

/** The credential stays in the connection and password field, never in a save. */
export class MiamiVisualControls {
  readonly root = document.createElement('section');
  private readonly footer = document.createElement('footer');
  private readonly streaming = document.createElement('div');
  private creditVersion = -1;
  private open = true;
  private started = false;
  constructor(private visuals: StreamedMiamiVisuals, private onOpen: (open: boolean) => void) {
    this.root.id = 'miami-source';
    this.root.innerHTML = `<button id="miami-source-toggle" type="button" aria-expanded="true">Miami 3D <span>↗</span></button>
      <form id="miami-source-form" autocomplete="off">
        <p>Live Brickell</p>
        <label for="miami-source-token">Cesium ion access token</label>
        <input id="miami-source-token" type="password" name="miami-source-token" autocomplete="off" spellcheck="false" required placeholder="Access token">
        <div class="miami-source-actions"><button type="submit">Connect</button><button id="miami-source-retry" type="button" hidden>Retry</button><button id="miami-source-disconnect" type="button" hidden>Disconnect</button></div>
        <small>Kept in this tab for this session.</small>
      </form><span id="miami-source-status" role="status" aria-live="polite">Not connected</span>`;
    this.footer.id = 'miami-attribution';
    this.footer.innerHTML = `<span id="miami-google-brand" hidden><img src="/attribution/google-maps.png" alt="Google Maps"></span><span id="miami-provider-credits" aria-label="Map data attribution"></span><span class="miami-own-credit">Gameplay & collision: independent public data</span>`;
    this.streaming.id = 'miami-collision-loading';
    this.streaming.hidden = true;
    this.streaming.setAttribute('role', 'status');
    this.streaming.textContent = 'Loading streets…';
    document.body.append(this.root, this.footer, this.streaming);
    this.root.querySelector('form')!.addEventListener('submit', e => {
      e.preventDefault();
      const field = this.root.querySelector<HTMLInputElement>('input')!;
      try { this.visuals.connect({ provider: 'ion', credential: field.value, assetId: '2275207' }); }
      catch { this.root.querySelector('#miami-source-status')!.textContent = 'Check the token and try again.'; }
      finally { field.value = ''; }
    });
    this.root.querySelector('#miami-source-toggle')!.addEventListener('click', () => this.show(!this.open));
    this.root.querySelector('#miami-source-retry')!.addEventListener('click', () => this.visuals.retry());
    this.root.querySelector('#miami-source-disconnect')!.addEventListener('click', () => this.visuals.disconnect());
  }
  show(open: boolean) {
    this.open = open;
    this.root.querySelector<HTMLElement>('form')!.hidden = !open;
    this.root.querySelector('button')!.setAttribute('aria-expanded', String(open));
    this.onOpen(open);
  }
  enterGame() { this.started = true; this.root.classList.add('in-game'); this.show(false); }
  setCollisionLoading(loading: boolean) { this.streaming.hidden = !loading || !this.started; }
  update(state: VisualSnapshot) {
    this.root.dataset.phase=state.phase; this.root.dataset.visibleTiles=String(state.visibleTiles);
    const labels: Record<VisualSnapshot['phase'], string> = { disconnected: 'Not connected', connecting: 'Connecting…', loading: 'Loading Miami…', visible: 'Live Brickell', partial: 'Some map detail could not load', failed: 'Map connection failed', disposed: 'Disconnected' };
    this.root.querySelector('#miami-source-status')!.textContent = labels[state.phase]+(state.error?.httpStatus?` (${state.error.httpStatus})`:'');
    if (state.phase === "visible" && !this.started && this.open) this.show(false);
    const connected = !['disconnected', 'disposed'].includes(state.phase);
    this.root.querySelector<HTMLButtonElement>('#miami-source-disconnect')!.hidden = !connected;
    this.root.querySelector<HTMLButtonElement>('#miami-source-retry')!.hidden = !state.error;
    this.footer.querySelector<HTMLElement>('#miami-google-brand')!.hidden = !state.requiresGoogleBranding;
    if (this.creditVersion !== state.creditVersion) {
      this.creditVersion = state.creditVersion;
      renderCredits(this.footer.querySelector('#miami-provider-credits')!, [...this.visuals.credits()]);
    }
  }
  dispose() { this.root.remove(); this.footer.remove(); this.streaming.remove(); }
}
