#!/bin/sh

netstat -ntl | grep -q 4444 || node /home/gcampagn/mobisocial/ThingEngine/demos/thingtv/main.js &
sleep 1
epiphany --application-mode --profile="/home/gcampagn/.config/epiphany/app-epiphany-thingtv-10d0632961cd8f72b757e9674c1c4e1bdbf88a07" http://127.0.0.1:4444/ &
sleep 10
wmctrl -r ThingTV -b add,fullscreen
