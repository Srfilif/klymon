package com.klymon.clientmenu.addon;

/**
 * A performance mod managed by the launcher (Sodium, Lithium, …). These entries
 * are never toggled, configured or persisted by the client: they exist so the
 * Performance tab can report what is installed, live, from the loader.
 */
public final class ExternalModAddon extends Addon {
    private final String modId;
    private final String modrinthSlug;

    public ExternalModAddon(String id, String modId, String modrinthSlug) {
        super(id, AddonCategory.PERFORMANCE, "*", true, "fabric-api");
        this.modId = modId;
        this.modrinthSlug = modrinthSlug;
    }

    public String modId() {
        return this.modId;
    }

    public String modrinthSlug() {
        return this.modrinthSlug;
    }

    public boolean installed() {
        return AddonManager.modLoaded(this.modId);
    }

    public String installedVersion() {
        return AddonManager.modVersion(this.modId);
    }
}
