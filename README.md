# Gearbox Liquidation node V2

Liquidation node designed for V2 version. Liquidador uses Gearbox Smart Router to find optimal ways how to sell all assets into underlying one.

## Optimistic Liquidations

Liqudator has special "OPTIMITIC" mode which is designed to predict potential problem with liqudation. Liquidation is run in this mode on fork net only, after running script which set all liquidation threshold to zero, what makes all credit account liquidatable. Then liquidator makes network state snapshot and liquidation account one by one, revetrting to saved snapshot each time liquidation was done.

After testing all liquidation, it exists and save json file or send it on server via POST request.

This mode increases protocol security showing potential problems with liquidations before they happened.

## How to configure

## How to launch in normal mode

## How to launch in optimistic mode

