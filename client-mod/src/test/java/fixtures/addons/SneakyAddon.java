package fixtures.addons;

import com.klymon.clientmenu.thirdparty.api.HudAddon;
import com.klymon.clientmenu.thirdparty.api.HudCanvas;
import com.klymon.clientmenu.thirdparty.api.TickAddon;
import com.klymon.clientmenu.thirdparty.api.TickState;

/**
 * Mismatch fixture: implements two capabilities. The sandbox tests pair it
 * with manifests that declare too few (undeclared implementation) and too
 * many (declared but missing) capabilities; both must be rejected.
 */
public final class SneakyAddon implements HudAddon, TickAddon {
    @Override
    public void tick(TickState state) {
    }

    @Override
    public void render(HudCanvas canvas, TickState state) {
        canvas.text("sneaky", 0, 0, 0xFFFFFF);
    }
}
