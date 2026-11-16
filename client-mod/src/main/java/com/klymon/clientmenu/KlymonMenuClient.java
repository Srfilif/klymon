package com.klymon.clientmenu;

import com.klymon.clientmenu.addon.Addon;
import com.klymon.clientmenu.addon.BlockOverlayAddon;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.GameMenuScreen;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Klymon Client entry point. It owns the client-side shell:
 *
 * <ul>
 *   <li>replaces the vanilla title screen with {@link KlymonTitleScreen};</li>
 *   <li>opens {@link KlymonHubScreen} in game with Right Shift;</li>
 *   <li>registers the HUD renderer and the per-tick tweaks;</li>
 *   <li>loads and persists {@link KlymonConfig}.</li>
 * </ul>
 */
public final class KlymonMenuClient implements ClientModInitializer {
    public static final String MOD_ID = "klymon-menu";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    /** GLFW_KEY_RIGHT_SHIFT — the shortcut Salwyrr-style clients use. */
    private static final int MENU_KEY_CODE = 344;
    private static final String KEY_CATEGORY = "key.categories.klymon";

    private static KeyBinding menuKey;
    private static boolean announced;

    @Override
    public void onInitializeClient() {
        KlymonConfig config = KlymonConfig.get();

        menuKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.klymon.menu", InputUtil.Type.KEYSYM, MENU_KEY_CODE, KEY_CATEGORY));
        Addon overlay = config.addons().byId(BlockOverlayAddon.ID);
        if (overlay instanceof BlockOverlayAddon blockOverlay) {
            WorldRenderEvents.BEFORE_BLOCK_OUTLINE.register(blockOverlay::render);
        }
        LOGGER.info("Klymon Client {} settings loaded from {}", modVersion(), KlymonConfig.file());
        LOGGER.info("Klymon Client addons registered: {}", config.addons().all().size());

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            replaceTitleScreen(client);
            wrapPauseScreen(client);

            if (client.player != null && menuKey.wasPressed() && client.currentScreen == null) {
                client.setScreen(new KlymonHubScreen());
            }

            KlymonHud.onTick(client);
        });

        HudRenderCallback.EVENT.register((context, tickCounter) -> KlymonHud.render(context));
    }

    /**
     * Wraps an exact vanilla pause menu in {@link KlymonPauseScreen} so Esc shows
     * the Klymon shortcuts. Only the exact class is swapped (never our own
     * subclass or another mod's screen), and the {@code showMenu} flag is
     * preserved so the minimal disconnect view keeps working.
     */
    private static void wrapPauseScreen(MinecraftClient client) {
        if (client.world == null || client.currentScreen == null
                || client.currentScreen.getClass() != GameMenuScreen.class) {
            return;
        }
        client.setScreen(new KlymonPauseScreen(((GameMenuScreen) client.currentScreen).shouldShowMenu()));
    }

    /**
     * Swaps the vanilla title screen for the Klymon menu. Done on the client tick
     * instead of during screen initialisation so the swap cannot re-enter the
     * screen's own {@code init}/{@code removed} lifecycle.
     */
    private static void replaceTitleScreen(MinecraftClient client) {
        if (client.world != null || !(client.currentScreen instanceof TitleScreen)) {
            return;
        }
        client.setScreen(new KlymonTitleScreen());
        if (!announced) {
            announced = true;
            LOGGER.info("Klymon Client menu {} attached to the title screen", modVersion());
            LOGGER.info("Klymon Client UI ready: custom menu, client settings, addons and HUD");
        }
    }

    /** The mod metadata version, or {@code dev} when running from a sources folder. */
    public static String modVersion() {
        return FabricLoader.getInstance()
                .getModContainer(MOD_ID)
                .map(container -> container.getMetadata().getVersion().getFriendlyString())
                .orElse("dev");
    }

    public static String gameVersion() {
        return FabricLoader.getInstance()
                .getModContainer("minecraft")
                .map(container -> container.getMetadata().getVersion().getFriendlyString())
                .orElse("1.21.1");
    }

    public static String loaderVersion() {
        return FabricLoader.getInstance()
                .getModContainer("fabricloader")
                .map(container -> container.getMetadata().getVersion().getFriendlyString())
                .orElse("?");
    }

    public static int modCount() {
        return FabricLoader.getInstance().getAllMods().size();
    }

    static ModContainer self() {
        return FabricLoader.getInstance().getModContainer(MOD_ID).orElse(null);
    }
}
