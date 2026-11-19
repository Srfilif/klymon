package fixtures.addons;

import com.klymon.clientmenu.thirdparty.api.HudAddon;
import com.klymon.clientmenu.thirdparty.api.HudCanvas;
import com.klymon.clientmenu.thirdparty.api.TickAddon;
import com.klymon.clientmenu.thirdparty.api.TickState;

/**
 * Dual-capability fixture: remembers the last tick snapshot and renders it.
 * Lets the sandbox tests observe both wirings through the facade.
 */
public final class MultiAddon implements HudAddon, TickAddon {
    private long lastTick = -1;
    private int lastFps = -1;

    @Override
    public void tick(TickState state) {
        lastTick = state.tick();
        lastFps = state.fps();
    }

    @Override
    public void render(HudCanvas canvas, TickState state) {
        canvas.text("tick=" + lastTick + " fps=" + lastFps, 0, 0, 0xFFFFFF);
        canvas.text("lambda=" + describe(), 0, 10, 0xFFFFFF);
    }

    /** Stream + lambda pipeline: proves invokedynamic survives the sandbox. */
    private String describe() {
        return java.util.List.of(lastTick, (long) lastFps).stream()
                .map(n -> "n" + n)
                .reduce("", (left, right) -> left + right);
    }
}
