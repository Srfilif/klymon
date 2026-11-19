package com.klymon.clientmenu.addon;

import java.util.LinkedHashMap;
import java.util.Map;

import com.klymon.clientmenu.logic.GammaPolicy;

import net.minecraft.client.MinecraftClient;

/**
 * Fullbright: raises gamma while enabled and restores the player's previous
 * value on disable (never a hardcoded guess).
 *
 * <p>The previous value is persisted inside this addon's profile settings, and
 * a live value equal to {@link GammaPolicy#FULLBRIGHT} is treated as residue
 * from an earlier session (the game saves {@code options.txt} while fullbright
 * is active), never as a genuine player setting.</p>
 */
public final class FullbrightAddon extends Addon implements Tickable {
    public static final String ID = "fullbright";

    /** Profile-settings key for the persisted previous gamma (not a UI setting). */
    private static final String PREVIOUS_KEY = "previousGamma";

    private boolean applied;
    private double previous = GammaPolicy.VANILLA_DEFAULT;
    private double persistedPrevious = GammaPolicy.VANILLA_DEFAULT;

    public FullbrightAddon() {
        super(ID, AddonCategory.UTILITY, "1.2.0", false);
    }

    @Override
    public void tick(MinecraftClient client) {
        if (enabled()) {
            if (!this.applied) {
                double captured = client.options.getGamma().getValue();
                this.previous = GammaPolicy.resolvePrevious(captured, this.persistedPrevious);
                this.persistedPrevious = this.previous;
                this.applied = true;
            }
            if (client.options.getGamma().getValue() != GammaPolicy.FULLBRIGHT) {
                client.options.getGamma().setValue(GammaPolicy.FULLBRIGHT);
            }
            return;
        }
        if (this.applied) {
            this.applied = false;
            client.options.getGamma().setValue(this.previous);
        }
    }

    @Override
    public Map<String, String> exportSettings() {
        Map<String, String> exported = new LinkedHashMap<>(super.exportSettings());
        exported.put(PREVIOUS_KEY, Double.toString(this.persistedPrevious));
        return exported;
    }

    @Override
    public void importSettings(Map<String, String> imported) {
        super.importSettings(imported);
        if (imported == null) {
            return;
        }
        double restored = parseLenient(imported.get(PREVIOUS_KEY), GammaPolicy.VANILLA_DEFAULT);
        this.persistedPrevious = GammaPolicy.isPlausible(restored) ? restored : GammaPolicy.VANILLA_DEFAULT;
        this.previous = this.persistedPrevious;
    }

    private static double parseLenient(String raw, double fallback) {
        if (raw == null) {
            return fallback;
        }
        try {
            return Double.parseDouble(raw.trim());
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }
}
