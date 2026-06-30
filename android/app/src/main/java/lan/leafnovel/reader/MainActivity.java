package lan.leafnovel.reader;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalFolderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
