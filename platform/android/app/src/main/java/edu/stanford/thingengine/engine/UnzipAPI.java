package edu.stanford.thingengine.engine;

/**
 * Created by gcampagn on 12/1/15.
 */
public class UnzipAPI extends JavascriptAPI {
    public UnzipAPI(ControlChannel control) {
        super("Unzip", control);

        registerAsync("unzip", new GenericCall() {
            @Override
            public Object run(Object... args) throws Exception {
                Unzipper.unzip((String)args[0], (String)args[1]);
                return null;
            }
        });
    }
}
