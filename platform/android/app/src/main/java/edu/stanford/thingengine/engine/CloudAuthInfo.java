package edu.stanford.thingengine.engine;

/**
 * Created by gcampagn on 10/7/15.
 */
public class CloudAuthInfo {
    private final String cloudId;
    private final String authToken;

    public CloudAuthInfo(String cloudId, String authToken) {
        this.cloudId = cloudId;
        this.authToken = authToken;
    }

    public String getCloudId() {
        return cloudId;
    }

    public String getAuthToken() {
        return authToken;
    }
}
