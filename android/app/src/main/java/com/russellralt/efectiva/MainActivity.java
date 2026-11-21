package com.russellralt.efectiva;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EfectivaTtsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
