package com.klymon.clientmenu;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

import com.klymon.clientmenu.config.ProfileDocument;
import com.klymon.clientmenu.config.ProfileManager;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.tooltip.Tooltip;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.client.network.ServerInfo;
import net.minecraft.text.Text;
import net.minecraft.util.Util;

/**
 * Profile manager: switch, create, duplicate, rename, delete, export and
 * import configuration profiles, plus per-server auto-load bindings.
 */
public final class KlymonProfilesScreen extends Screen {
    private static final int PANEL_WIDTH = 520;
    private static final int PANEL_HEIGHT = 300;

    private final Screen parent;
    private String selectedId;
    private String renameText;
    private String status;

    public KlymonProfilesScreen(Screen parent) {
        super(Text.translatable("klymon.profiles.title"));
        this.parent = parent;
        this.selectedId = KlymonConfig.get().activeProfileId();
    }

    private static KlymonConfig config() {
        return KlymonConfig.get();
    }

    private ProfileDocument.Profile selected() {
        ProfileDocument document = config().document();
        ProfileDocument.Profile profile = document.profiles.get(this.selectedId);
        if (profile == null) {
            this.selectedId = document.activeProfile;
            profile = document.profiles.get(this.selectedId);
        }
        return profile;
    }

    @Override
    protected void init() {
        ProfileDocument document = config().document();
        int panelX = (this.width - PANEL_WIDTH) / 2;
        int panelY = (this.height - PANEL_HEIGHT) / 2;
        int leftY = panelY + 48;

        // Left: profile list (select).
        List<String> ids = ProfileManager.orderedIds(document);
        int shown = 0;
        for (String id : ids) {
            if (shown >= 9) {
                break;
            }
            ProfileDocument.Profile profile = document.profiles.get(id);
            String label = (id.equals(document.activeProfile) ? "✓ " : "") + profile.name
                    + (profile.builtin ? " ●" : "");
            this.addDrawableChild(ButtonWidget.builder(Text.literal(label), button -> {
                        this.selectedId = id;
                        this.renameText = null;
                        this.status = null;
                        this.clearAndInit();
                    })
                    .dimensions(panelX + 20, leftY + shown * 22, 190, 20)
                    .tooltip(Tooltip.of(Text.translatable(
                            profile.builtin ? "klymon.profiles.builtinHint" : "klymon.profiles.customHint")))
                    .build());
            shown++;
        }

        // Right: actions for the selection.
        int rx = panelX + 222;
        int rw = PANEL_WIDTH - 242;
        int ry = panelY + 48;
        ProfileDocument.Profile profile = selected();
        boolean isActive = this.selectedId.equals(document.activeProfile);

        this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.profiles.use"), button -> {
                    if (config().switchProfile(this.selectedId)) {
                        this.status = Text.translatable("klymon.profiles.switched",
                                config().document().profiles.get(this.selectedId).name).getString();
                    }
                    this.clearAndInit();
                })
                .dimensions(rx, ry, (rw - 4) / 2, 20).build());
        this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.profiles.duplicate"), button -> {
                    try {
                        this.selectedId = ProfileManager.duplicate(document, this.selectedId, null);
                        config().save();
                        this.status = Text.translatable("klymon.profiles.duplicated").getString();
                    } catch (RuntimeException error) {
                        this.status = error.getMessage();
                    }
                    this.clearAndInit();
                })
                .dimensions(rx + (rw - 4) / 2 + 4, ry, (rw - 4) / 2, 20).build());
        ry += 24;

        this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.profiles.create"), button -> {
                    try {
                        this.selectedId = ProfileManager.create(document,
                                Text.translatable("klymon.profiles.newName").getString());
                        config().save();
                        this.status = Text.translatable("klymon.profiles.created").getString();
                    } catch (RuntimeException error) {
                        this.status = error.getMessage();
                    }
                    this.clearAndInit();
                })
                .dimensions(rx, ry, (rw - 4) / 2, 20).build());
        if (profile.builtin) {
            this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.profiles.resetPreset"), button -> {
                        try {
                            config().resetBuiltinPreset(this.selectedId);
                            this.status = Text.translatable("klymon.profiles.presetReset").getString();
                        } catch (RuntimeException error) {
                            this.status = error.getMessage();
                        }
                        this.clearAndInit();
                    })
                    .dimensions(rx + (rw - 4) / 2 + 4, ry, (rw - 4) / 2, 20)
                    .build());
        } else {
            ButtonWidget.Builder delete = ButtonWidget.builder(Text.translatable("klymon.profiles.delete"), button -> {
                try {
                    ProfileManager.delete(document, this.selectedId);
                    this.selectedId = document.activeProfile;
                    config().save();
                    this.status = Text.translatable("klymon.profiles.deleted").getString();
                } catch (RuntimeException error) {
                    this.status = error.getMessage();
                }
                this.clearAndInit();
            });
            if (isActive) {
                delete.tooltip(Tooltip.of(Text.translatable("klymon.profiles.deleteHint")));
            }
            this.addDrawableChild(delete.dimensions(rx + (rw - 4) / 2 + 4, ry, (rw - 4) / 2, 20).build());
        }
        ry += 24;

        // Rename row.
        if (this.renameText == null) {
            this.renameText = profile.name;
        }
        TextFieldWidget rename = new TextFieldWidget(this.textRenderer, rx, ry, rw - 84, 20,
                Text.translatable("klymon.profiles.renameHint"));
        rename.setMaxLength(32);
        rename.setText(this.renameText);
        rename.setChangedListener(text -> this.renameText = text);
        this.addDrawableChild(rename);
        this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.profiles.rename"), button -> {
                    try {
                        ProfileManager.rename(document, this.selectedId, this.renameText);
                        config().save();
                        this.status = Text.translatable("klymon.profiles.renamed").getString();
                    } catch (RuntimeException error) {
                        this.status = error.getMessage();
                    }
                    this.clearAndInit();
                })
                .dimensions(rx + rw - 80, ry, 80, 20).build());
        ry += 24;

        // Export + open folder.
        this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.profiles.export"), button -> {
                    try {
                        Path file = exportSelected();
                        this.status = Text.translatable("klymon.profiles.exported", file.getFileName().toString()).getString();
                    } catch (RuntimeException error) {
                        this.status = error.getMessage();
                    }
                    this.clearAndInit();
                })
                .dimensions(rx, ry, (rw - 4) / 2, 20).build());
        this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.profiles.openFolder"), button -> {
                    try {
                        Files.createDirectories(KlymonConfig.exportDir());
                        Util.getOperatingSystem().open(KlymonConfig.exportDir().toFile());
                    } catch (Exception error) {
                        this.status = error.getMessage();
                        this.clearAndInit();
                    }
                })
                .dimensions(rx + (rw - 4) / 2 + 4, ry, (rw - 4) / 2, 20).build());
        ry += 24;

        // Import (recent export files) + server binding.
        List<Path> imports = importCandidates();
        if (!imports.isEmpty()) {
            Path candidate = imports.get(0);
            this.addDrawableChild(ButtonWidget.builder(
                            Text.translatable("klymon.profiles.import", candidate.getFileName().toString()),
                            button -> {
                                try {
                                    String json = Files.readString(candidate, StandardCharsets.UTF_8);
                                    this.selectedId = ProfileManager.importProfile(document, json);
                                    config().save();
                                    this.status = Text.translatable("klymon.profiles.imported",
                                            document.profiles.get(this.selectedId).name).getString();
                                } catch (Exception error) {
                                    this.status = error.getMessage();
                                }
                                this.clearAndInit();
                            })
                    .dimensions(rx, ry, rw, 20)
                    .tooltip(Tooltip.of(Text.translatable("klymon.profiles.importHint", imports.size())))
                    .build());
            ry += 24;
        }

        String server = currentServerAddress();
        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable(server == null ? "klymon.profiles.noServer" : "klymon.profiles.bind",
                                server == null ? "" : server),
                        button -> {
                            if (server != null) {
                                config().bindServer(server, this.selectedId);
                                this.status = Text.translatable("klymon.profiles.bound", server).getString();
                                this.clearAndInit();
                            }
                        })
                .dimensions(rx, ry, rw, 20).build());
        ry += 24;

        // Bindings (click one to remove it).
        List<Map.Entry<String, String>> bindings = new ArrayList<>(document.serverBindings.entrySet());
        bindings.sort(Map.Entry.comparingByKey());
        int bindingRoom = panelY + PANEL_HEIGHT - 30 - ry;
        int bindingRows = Math.min(bindings.size(), Math.max(0, bindingRoom / 22));
        for (int i = 0; i < bindingRows; i++) {
            Map.Entry<String, String> binding = bindings.get(i);
            ProfileDocument.Profile target = document.profiles.get(binding.getValue());
            String label = binding.getKey() + " → " + (target == null ? "?" : target.name);
            this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.profiles.unbind", label), button -> {
                        config().unbindServer(binding.getKey());
                        this.status = Text.translatable("klymon.profiles.unbound", binding.getKey()).getString();
                        this.clearAndInit();
                    })
                    .dimensions(rx, ry, rw, 20).build());
            ry += 22;
        }

        this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.menu.back"), button -> this.close())
                .dimensions(panelX + 20, panelY + PANEL_HEIGHT - 30, 190, 20).build());
    }

    private String currentServerAddress() {
        if (this.client == null || this.client.world == null || this.client.isInSingleplayer()) {
            return null;
        }
        ServerInfo entry = this.client.getCurrentServerEntry();
        return entry == null ? null : entry.address;
    }

    private Path exportSelected() {
        try {
            Files.createDirectories(KlymonConfig.exportDir());
            Path file = KlymonConfig.exportDir().resolve(this.selectedId + ".json");
            Files.writeString(file, ProfileManager.exportProfile(config().document(), this.selectedId),
                    StandardCharsets.UTF_8);
            KlymonMenuClient.LOGGER.info("Exported Klymon profile '{}' to {}", this.selectedId, file);
            return file;
        } catch (Exception error) {
            throw new RuntimeException(error.getMessage());
        }
    }

    private static List<Path> importCandidates() {
        try {
            Path dir = KlymonConfig.exportDir();
            if (!Files.isDirectory(dir)) {
                return List.of();
            }
            List<Path> files = new ArrayList<>();
            try (var stream = Files.list(dir)) {
                stream.filter(path -> path.getFileName().toString().endsWith(".json")).forEach(files::add);
            }
            files.sort(Comparator.comparingLong((Path path) -> {
                try {
                    return Files.getLastModifiedTime(path).toMillis();
                } catch (Exception ignored) {
                    return 0L;
                }
            }).reversed());
            return files;
        } catch (Exception ignored) {
            return List.of();
        }
    }

    /** Drawn as part of the single background pass so {@code super.render} cannot blur it away. */
    @Override
    public void renderBackground(DrawContext context, int mouseX, int mouseY, float delta) {
        super.renderBackground(context, mouseX, mouseY, delta);

        int panelX = (this.width - PANEL_WIDTH) / 2;
        int panelY = (this.height - PANEL_HEIGHT) / 2;
        KlymonTheme.panel(context, panelX, panelY, PANEL_WIDTH, PANEL_HEIGHT);
        KlymonTheme.header(context, this.textRenderer, this.title,
                Text.translatable("klymon.profiles.subtitle"), this.width / 2, panelY + 14);
        context.fill(panelX + 20, panelY + 42, panelX + PANEL_WIDTH - 20, panelY + 43,
                KlymonTheme.alpha(KlymonTheme.accent(), 0x50));

        if (this.status != null) {
            KlymonTheme.footer(context, this.textRenderer, Text.literal(this.status),
                    panelX + 222 + (PANEL_WIDTH - 242) / 2, panelY + PANEL_HEIGHT - 14);
        }
    }

    @Override
    public void close() {
        config().save();
        this.client.setScreen(this.parent);
    }
}
