package com.notedown.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(NotedownNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
