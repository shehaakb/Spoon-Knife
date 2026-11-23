// 99-boot.js — start the app: render the shell immediately ("loading"), then light up data.
const RB = globalThis.RB;
RB.shell.start();
RB.store.start();
RB.actions.warmDownloads();
