package com.klymon.clientmenu;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicBoolean;

import com.klymon.clientmenu.platform.ApiBaseStore;
import com.klymon.clientmenu.platform.DeviceLink;
import com.klymon.clientmenu.platform.PlatformLink;
import com.klymon.clientmenu.platform.PlatformUrls;

import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.text.Text;

/**
 * Connect Account (§6 third-party path): shows a device code to approve on
 * another device, then polls until the game links. All network runs on a
 * worker; the screen only renders snapshots.
 */
public final class KlymonLinkScreen extends Screen {
    private static final int PANEL_WIDTH = 380;
    private static final int PANEL_HEIGHT = 216;

    private final Screen parent;
    private String apiText;
    private String notice;
    private DeviceLink.State lastSeen = DeviceLink.State.IDLE;
    private final AtomicBoolean working = new AtomicBoolean(false);

    public KlymonLinkScreen(Screen parent) {
        super(Text.translatable("klymon.link.title"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        int panelX = (this.width - PANEL_WIDTH) / 2;
        int panelY = (this.height - PANEL_HEIGHT) / 2;
        int x = panelX + 24;
        int w = PANEL_WIDTH - 48;
        int row = panelY + 62;

        String linked = PlatformLink.username();
        DeviceLink link = PlatformLink.deviceLink();
        DeviceLink.State state = link == null ? DeviceLink.State.IDLE : link.state();
        this.lastSeen = state;

        if (linked != null) {
            this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.menu.back"), button -> this.close())
                    .dimensions(x, row + 96, w, 20).build());
            return;
        }

        if (state == DeviceLink.State.AWAITING && link != null) {
            this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.link.copy"), button -> {
                        if (this.client != null && link.userCode() != null) {
                            this.client.keyboard.setClipboard(link.userCode());
                            this.notice = Text.translatable("klymon.link.copied").getString();
                        }
                    })
                    .dimensions(x, row + 72, (w - 8) / 2, 20).build());
            this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.link.cancel"), button -> {
                        link.cancel();
                        this.notice = null;
                        this.clearAndInit();
                    })
                    .dimensions(x + (w - 8) / 2 + 8, row + 72, (w - 8) / 2, 20).build());
            return;
        }

        if (this.apiText == null) {
            String stored = ApiBaseStore.read(FabricLoader.getInstance().getConfigDir());
            this.apiText = stored != null ? stored : ApiBaseStore.DEFAULT_API_BASE;
        }
        TextFieldWidget api = new TextFieldWidget(this.textRenderer, x, row, w, 20, Text.translatable("klymon.link.apiUrl"));
        api.setMaxLength(256);
        api.setText(this.apiText);
        api.setChangedListener(text -> this.apiText = text);
        this.addDrawableChild(api);

        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable(state == DeviceLink.State.FAILED ? "klymon.link.retry" : "klymon.link.getCode"),
                        button -> requestCode())
                .dimensions(x, row + 28, w, 20).build());
        this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.menu.back"), button -> this.close())
                .dimensions(x, row + 96, w, 20).build());
    }

    private void requestCode() {
        DeviceLink link = PlatformLink.deviceLink();
        if (link == null || !working.compareAndSet(false, true)) {
            return;
        }
        String base = this.apiText == null ? "" : this.apiText.trim();
        if (PlatformUrls.normalizeBase(base) == null) {
            working.set(false);
            this.notice = Text.translatable("klymon.link.badUrl").getString();
            this.clearAndInit();
            return;
        }
        worker().submit(() -> {
            try {
                try {
                    ApiBaseStore.write(FabricLoader.getInstance().getConfigDir(), base);
                } catch (Exception ignored) {
                    // A read-only config dir only means the URL is not remembered.
                }
                link.start(base, "Klymon Client " + KlymonMenuClient.modVersion(), System.currentTimeMillis());
            } finally {
                working.set(false);
                if (this.client != null) {
                    this.client.execute(this::clearAndInit);
                }
            }
        });
    }

    @Override
    public void tick() {
        super.tick();
        DeviceLink link = PlatformLink.deviceLink();
        if (link == null || PlatformLink.username() != null) {
            if (link != null && link.state() != lastSeen) {
                clearAndInit();
            }
            return;
        }
        if (link.state() != lastSeen) {
            clearAndInit();
            return;
        }
        if (link.state() == DeviceLink.State.AWAITING && link.pollDue(System.currentTimeMillis())
                && working.compareAndSet(false, true)) {
            worker().submit(() -> {
                try {
                    link.poll(System.currentTimeMillis());
                } finally {
                    working.set(false);
                    if (this.client != null) {
                        this.client.execute(this::clearAndInit);
                    }
                }
            });
        }
    }

    @Override
    public void renderBackground(DrawContext context, int mouseX, int mouseY, float delta) {
        super.renderBackground(context, mouseX, mouseY, delta);
        int panelX = (this.width - PANEL_WIDTH) / 2;
        int panelY = (this.height - PANEL_HEIGHT) / 2;
        KlymonTheme.panel(context, panelX, panelY, PANEL_WIDTH, PANEL_HEIGHT);
        KlymonTheme.header(context, this.textRenderer, this.title,
                Text.translatable("klymon.link.subtitle"), this.width / 2, panelY + 16);

        String linked = PlatformLink.username();
        DeviceLink link = PlatformLink.deviceLink();
        DeviceLink.State state = link == null ? DeviceLink.State.IDLE : link.state();
        int x = panelX + 24;
        if (linked != null) {
            KlymonTheme.footer(context, this.textRenderer,
                    Text.translatable("klymon.link.linked", linked), this.width / 2, panelY + 96);
        } else if (state == DeviceLink.State.AWAITING && link != null && link.userCode() != null) {
            context.drawTextWithShadow(this.textRenderer,
                    Text.translatable("klymon.link.codeAt", link.verificationUri() == null ? "" : link.verificationUri()),
                    x, panelY + 66, KlymonTheme.MUTED);
            context.drawTextWithShadow(this.textRenderer, Text.literal(link.userCode()),
                    x, panelY + 82, KlymonTheme.accent());
            KlymonTheme.footer(context, this.textRenderer,
                    Text.translatable("klymon.link.waiting"), this.width / 2, panelY + 150);
        } else {
            if (state == DeviceLink.State.FAILED) {
                KlymonTheme.footer(context, this.textRenderer,
                        Text.translatable("klymon.link.failed"), this.width / 2, panelY + 150);
            } else if (this.notice != null) {
                KlymonTheme.footer(context, this.textRenderer,
                        Text.literal(this.notice), this.width / 2, panelY + 150);
            }
        }
    }

    @Override
    public void close() {
        this.client.setScreen(this.parent);
    }

    private static ExecutorService worker() {
        return Holder.EXECUTOR;
    }

    private static final class Holder {
        private static final ThreadFactory DAEMON = runnable -> {
            Thread thread = new Thread(runnable, "klymon-link");
            thread.setDaemon(true);
            return thread;
        };
        private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor(DAEMON);
    }
}
