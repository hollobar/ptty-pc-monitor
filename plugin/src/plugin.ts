import streamDeck from "@elgato/streamdeck";

import { BrightnessDial } from "./actions/brightness-dial";
import { SensorDisplay } from "./actions/sensor-display";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new SensorDisplay());
streamDeck.actions.registerAction(new BrightnessDial());

streamDeck.connect();
