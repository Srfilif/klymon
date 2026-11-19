package fixtures.addons;

import com.klymon.clientmenu.thirdparty.api.ConfigurableAddon;
import com.klymon.clientmenu.thirdparty.api.HudAddon;
import com.klymon.clientmenu.thirdparty.api.HudCanvas;
import com.klymon.clientmenu.thirdparty.api.TickState;
import java.util.HashMap;
import java.util.Map;

/**
 * Config fixture: reports what the platform delivered at load through its
 * HUD output, since the tests can only observe sandboxed instances through
 * the shared facade interfaces.
 */
public final class ConfigEchoAddon implements HudAddon, ConfigurableAddon {
    private final Map<String, String> received = new HashMap<>();
    private boolean unmodifiable;

    @Override
    public Map<String, String> defaultConfig() {
        return Map.of("color", "red");
    }

    @Override
    public void configure(Map<String, String> values) {
        received.clear();
        received.putAll(values);
        try {
            values.put("probe", "probe");
            unmodifiable = false;
        } catch (UnsupportedOperationException e) {
            unmodifiable = true;
        }
    }

    @Override
    public void render(HudCanvas canvas, TickState state) {
        canvas.text("color=" + received.getOrDefault("color", "?"), 0, 0, 0xFFFFFF);
        canvas.text("unmodifiable=" + unmodifiable, 0, 10, 0xFFFFFF);
    }
}
