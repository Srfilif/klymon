package fixtures.addons;

import com.klymon.clientmenu.thirdparty.api.HudAddon;
import com.klymon.clientmenu.thirdparty.api.HudCanvas;
import com.klymon.clientmenu.thirdparty.api.TickState;

/**
 * Hostile fixture: compiles against the plain JDK but every branch it can
 * take touches a forbidden API (filesystem, processes, sockets,
 * reflection). The sandbox must reject it at scan time, before any of this
 * code is ever defined or run.
 */
public final class MeanAddon implements HudAddon {
    @Override
    public void render(HudCanvas canvas, TickState state) {
        try {
            touchEverything(state.tick());
        } catch (Exception e) {
            canvas.text("mean", 0, 0, 0xFFFFFF);
        }
    }

    private void touchEverything(long tick) throws Exception {
        java.io.File marker = new java.io.File("/tmp/klymon-pwned-" + tick);
        if (marker.exists()) {
            canvasSink(marker.getAbsolutePath());
        }
        Runtime runtime = Runtime.getRuntime();
        canvasSink(runtime.availableProcessors());
        java.net.Socket socket = new java.net.Socket();
        socket.close();
        Class<?> escape = Class.forName("java.lang.System");
        canvasSink(escape.getName());
    }

    private void canvasSink(Object value) {
        if (value == null) {
            throw new IllegalStateException("unreachable");
        }
    }
}
