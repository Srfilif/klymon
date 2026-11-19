package fixtures.addons;

import com.klymon.clientmenu.thirdparty.api.HudAddon;
import com.klymon.clientmenu.thirdparty.api.HudCanvas;
import com.klymon.clientmenu.thirdparty.api.TickState;

/**
 * Loader-gate fixture: directly calls {@code MethodHandles.lookup()}, the
 * reflective escape hatch. The static scan tolerates the reference (javac
 * emits it as a phantom {@code InnerClasses} entry for every lambda/concat
 * user), but the loader must refuse to link it, so invoking this addon dies
 * with a linkage error instead of handing out a lookup.
 */
public final class HandleSneakAddon implements HudAddon {
    @Override
    public void render(HudCanvas canvas, TickState state) {
        java.lang.invoke.MethodHandles.lookup();
        canvas.text("escaped", 0, 0, 0xFFFFFF);
    }
}
