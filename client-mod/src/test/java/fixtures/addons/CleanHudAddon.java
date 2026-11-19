package fixtures.addons;

import com.klymon.clientmenu.thirdparty.api.HudAddon;
import com.klymon.clientmenu.thirdparty.api.HudCanvas;
import com.klymon.clientmenu.thirdparty.api.TickState;

/**
 * Minimal well-behaved third-party addon used by the sandbox tests: draws
 * one text and one rectangle, touches nothing outside the facade.
 */
public final class CleanHudAddon implements HudAddon {
    @Override
    public void render(HudCanvas canvas, TickState state) {
        canvas.text("clean", 3, 4, 0xFFFFFF);
        canvas.rect(0, 0, 10, 10, 0xFF0000);
    }
}
