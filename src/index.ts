import { createMachine, createActor, assign, fromPromise } from "xstate";
import { speechstate, Settings, Hypothesis } from "speechstate";

const azureCredentials = {
  endpoint:
    "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: "9cd3cbcc05da4e198c3ba6b680d52ec4",
};

const settings: Settings = {
  azureCredentials: azureCredentials,
  asrDefaultCompleteTimeout: 0,
  locale: "en-US",
  asrDefaultNoInputTimeout: 5000,
  ttsDefaultVoice: "en-GB-RyanNeural",
};

interface DMContext {
  spstRef?: any;
  lastResult?: Hypothesis[];
  favColor?: string;
  favFood?: string;
  respCheck?: string;
  breathCheck?: string;
  cprCheck?: string;
}

// helper functions
const say =
  (text: string) =>
  ({ context }) => {
    context.spstRef.send({
      type: "SPEAK",
      value: { utterance: text },
    });
  };
const listen =
  () =>
  ({ context }) =>
    context.spstRef.send({
      type: "LISTEN",
    });

// ChatGPT invocation
async function fetchFromChatGPT(prompt: string, max_tokens: number) {
  const myHeaders = new Headers();
  myHeaders.append(
    "Authorization",
    //"Bearer <it is a secret shhh>",
    "Bearer "
  );
  myHeaders.append("Content-Type", "application/json");
  const raw = JSON.stringify({
    model: "gpt-3.5-turbo",
    messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
    temperature: 0,
    max_tokens: max_tokens,
  });

  const response = fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: myHeaders,
    body: raw,
    redirect: "follow",
  })
  .then((response) => response.json())
  .then((response) => {
    console.log(response.choices[0].message.content);  // logging the response to console
    return response.choices[0].message.content;
  });

  return response;
}


//const grammar = {
//  "blablabla": {
//    entities: ["element_entity"]
//  },
//}

const grammar = {
  affirmative: ["yes", "yeah", "he's breathing", "she's breathing", "I think so", "is reponsive", "is responding", "I have training", "I'm trained"], //"I do"
  negative: ["no", "not breathing", "isn't breathing", "no pulse", "I do not think so", "I don't think so", "not responding", "not responsive", "I don't have training", "I'm a beginner", "never done it"],
  next_step: ["next", "ready"]
}



function checkResponse(response: object, grammar: { [key: string]: string[] }) {
  let responseStr = JSON.stringify(response);
  
  const keys = ['affirmative', 'negative', 'next_step'];
  for (const key of keys) {
    const phrases = grammar[key];
    for (const phrase of phrases) {
      if (responseStr.toLowerCase().includes(phrase.toLowerCase())) {
        console.log('phrase: ', phrase)
        return key;
      }
    }
  }
  return null;
}



//const test = checkResponse('Yes', grammar)
//console.log('TEST: ', test)

// machineS
const dmMachine = createMachine(
  {
    id: "root",
    type: "parallel",
    states: {
      DialogueManager: {
        initial: "Prepare",
        states: {
          Prepare: {
            on: { ASRTTS_READY: "Ready" },
            entry: [
              assign({
                spstRef: ({ spawn }) => {
                  return spawn(speechstate, {
                    input: {
                      settings: settings,
                    },
                  });
                },
              }),
            ],
          },
          Ready: {
            initial: "Greeting",
            states: {
              Greeting: {
                entry: "speak.greeting",
                on: { SPEAK_COMPLETE: "HowCanIHelp" },
              },
              HowCanIHelp: {
                entry: say("How can I help you?"),
                //entry: say("Ah, ha, ha, ha, stayin' alive, stayin' alive. Ah, ha, ha, ha, stayin' alive"),
                on: { SPEAK_COMPLETE: "Ask" },
              },
              Ask: {
                entry: listen(),
                on: {
                  RECOGNISED: {
                    //target: "Repeat",
                    target: "Responsiveness",
                    //target: "CPRKnowledge",
                    actions: [
                      ({ event }) => console.log(event),
                      assign({
                        lastResult: ({ event }) => event.value,
                      }),
                    ],
                  },
                },
              },
              Responsiveness: {
                entry: say("Is the person conscious?"),
                on: { SPEAK_COMPLETE: "SaveResponsiveness" },
              },
              SaveResponsiveness: {
                entry: listen(),
                on: {
                  RECOGNISED: {
                    target: "Breathing",
                    actions: [
                      ({ event }) => console.log(event),
                      assign({
                        respCategory: ({ event }) => {
                          const category = checkResponse(event.value, grammar);
                          return category === 'affirmative' ? 'responsive' : 'irresponsive';
                        },
                        //responsiveness: ({ context }) => context.respCategory
                      }),
                    ],
                  },
                },
              },
              Breathing: {
                entry: say("Is the person breathing?"),
                on: { SPEAK_COMPLETE: "SaveBreathing" },
              },
              SaveBreathing: {
                entry: listen(),
                on: {
                  RECOGNISED: {
                    target: "CPRKnowledge",
                    actions: [
                      ({ event }) => console.log(event),
                      assign({
                        //breathCheck: ({ event }) => event.value,
                        respCategory: ({ event }) => {
                          const category = checkResponse(event.value, grammar);
                          return category === 'affirmative' ? 'breathing' : 'not breathing';
                          },
                          //responsiveness: ({ context }) => context.respCategory
                      }),
                    ],
                  },
                },
              },
              CPRKnowledge: {
                entry: say("Do you have training in CPR?"),
                on: { SPEAK_COMPLETE: "SaveCPRKnowledge" },
              },
              SaveCPRKnowledge: {
                entry: listen(),
                on: {
                  RECOGNISED: {
                    target: "AskChatGPT",
                    actions: [
                      ({ event }) => console.log(event),
                      assign({
                        //cprCheck: ({ event }) => event.value,
                        respCategory: ({ event }) => {
                          const category = checkResponse(event.value, grammar);
                          return category === 'affirmative' ? 'advanced' : 'beginner';
                          },
                          //responsiveness: ({ context }) => context.respCategory
                      }),
                    ],
                  },
                },
              },
              AskChatGPT: {
                invoke: {
                  src: fromPromise(async({ input }) => {
                    //const gptData = await fetchFromChatGPT(`I need you to give CPR instructions in JSON format within the following entities: step1_JSON, step2_JSON, step3_JSON and step4_JSON. You should take the following characteristics into account at the time of providing instructions. The victim is ${input.responsiveness} and ${input.breathing}. The user ${input.cpr_knowledge} previous CPR knowledge.`, 50);
                    const gptData = await fetchFromChatGPT(`I need you to provide concise CPR instructions regarding making an emergency call, the surface where the victim is located, the placement of hands for performing CPR, compressions and rescue breaths. Before providing instructions you should know that the victim is an adult and the person's status is ${input.responsiveness} and ${input.breathing}. My level of experience with CPR is ${input.cpr_knowledge}, so the instructions should be more detailed for someone with no or little experience and just a reminder of the steps for a trained person. I need the instructions in JSON format, including the following entities: emergencyCall_JSON, firmSurface_JSON, placingFingers_JSON, startingCompressions_JSON and rescueBreaths_JSON. For example: "emergencyCall_JSON": "Call 911 or your local emergency number. If someone else is present, ask them to do this".`, 350);
                    //const gptData = await fetchFromChatGPT(`I need you to provide concise CPR instructions regarding making an emergency call, the surface where the victim is located, the placement of hands for performing CPR, compressions and rescue breaths. Before providing instructions you should know that the victim is an adult and the person's status is not responsive and not breathing. My level of experience with CPR is ${input.cpr_knowledge}, so the instructions should be more detailed for someone with no or little experience and just a reminder of the steps for a trained person. I need the instructions in JSON format, including the following entities: emergencyCall_JSON, firmSurface_JSON, placingFingers_JSON, startingCompressions_JSON and rescueBreaths_JSON. For example: "emergencyCall_JSON": "Call 911 or your local emergency number. If someone else is present, ask them to do this".`, 350);
                    //"I need you to provide concise CPR instructions for a {"victim_age"} who's state  is {"victim_responsive"}, knowing that my knowledge of CPR is {"user_cpr_knowledge"}. The information should be in JSON format, including the following entities: emergencyCall_JSON, firmSurface_JSON, placingFingers_JSON, startingCompressions_JSON, rescueBreaths_JSON and keepUp_JSON."
                    return gptData;
                  }),
                  input: ({ context, event }) => ({
                    responsiveness: context.responsiveness,
                    breathing: context.breathing,
                    cpr_knowledge: context.cpr_knowledge,
                    lastResult: context.lastResult,
                  }),
                  onDone: {
                    target: "emergencyCall", //Repeat
                    actions: [
                      ({ event }) => console.log(JSON.parse(event.output)),
                      assign({ //emergencyCall_JSON, firmSurface_JSON, placingFingers_JSON, startingCompressions_JSON and rescueBreaths_JSON
                        //emergencyCall_JSON: ({ event }) => JSON.parse(event.output).emergencyCall_JSON,
                        emergencyCall_JSON: ({ event }) => ({
                          instructions: JSON.parse(event.output).emergencyCall_JSON,
                          mediaUrl: "https://media.giphy.com/media/3orieMQS2105J5Sn5K/giphy.gif"
                        }),
                        //firmSurface_JSON: ({ event }) => JSON.parse(event.output).firmSurface_JSON,
                        firmSurface_JSON: ({ event }) => ({
                          instruction: JSON.parse(event.output).firmSurface_JSON,
                          mediaUrl: "https://media.giphy.com/media/xT5LMKKlg8MK5g24Wk/giphy.gif"
                        }),
                        placingFingers_JSON: ({ event }) => JSON.parse(event.output).placingFingers_JSON,
                        //placingFingers_JSON: ({ event }) => ({
                        //  instruction: JSON.parse(event.output).placingFingers_JSON,
                        //  mediaUrl: "https://media.giphy.com/media/d07PtnTq0oVsk/giphy.gif"
                        //}),
                        startingCompressions_JSON: ({ event }) => JSON.parse(event.output).startingCompressions_JSON,
                        //startingCompressions_JSON: ({ event }) => ({
                        //  instruction: JSON.parse(event.output).startingCompressions_JSON,
                        //  mediaUrl: "https://media.giphy.com/media/7gD76BxsSjxTLEJV1y/giphy.gif"
                        //}),
                        rescueBreaths_JSON: ({ event }) => JSON.parse(event.output).rescueBreaths_JSON,
                        //rescueBreaths_JSON: ({ event }) => ({
                        //  instruction: JSON.parse(event.output).rescueBreaths_JSON,
                        //  mediaUrl: "https://media.giphy.com/media/26uf0Bl4inbl1ByAU/giphy.gif"
                        //}),
                      }),
                    ],
                  },
                }, 
              },
              emergencyCall: {
                entry: [
                  ({ context}) => { 
                    context.spstRef.send({ 
                      type: "SPEAK", 
                      value: { utterance: `Call 911 or your local emergency number. If someone else is present, ask them to do this. When you're ready for the next step, say "next" or "ready".` }
                      //value:{ utterance: `Ok. ${context.emergencyCall_JSON.instruction} When you're ready for the next step, say "next" or "ready".`}
                  });
                },
                ({ context }) => {
                  const mediaElement = document.getElementById('instructionMedia');
                  mediaElement.src = context.emergencyCall_JSON.mediaUrl;
                  mediaElement.style.display = 'block';
                }
              ],
                on: { SPEAK_COMPLETE: "Next" }, //Repeat
              },
              Next: {
                entry: listen(),
                on: { 
                  RECOGNISED: [
                    {
                      target: "firmSurface",
                      //cond: ({ event }) => event.value.toLowerCase() === "next" || event.value.toLowerCase() === "ready",
                      cond: ({ event }) => checkResponse(event.value, grammar) === 'next_step',
                    },
                    {
                      target: "RepeatStep",
                    }
                  ],
                },
              },
              RepeatStep: {
                entry: ({ context}) => { 
                  context.spstRef.send({ 
                    type: "SPEAK", 
                    value:{ utterance: `Do you want me to repeat the step? Say "yes" or  "no"`}
                  });
                },
                on: { SPEAK_COMPLETE: "RepYesOrNo" }, //Repeat
              },
              RepYesOrNo: {
                entry: listen(),
                on: { 
                  RECOGNISED: [
                    {
                      target: "emergencyCall",
                      cond: ({ event }) => event.value.toLowerCase() === "yes",
                    },
                    {
                      target: "firmSurface",
                      cond: ({ event }) => event.value.toLowerCase() === "no",
                    },
                  ],
                },
              },
              //Wait10Seconds: {
              //  after: {
              //    10000: "firmSurface",
              //  },
              //},

              //firmSurface: {
              //  entry: ({ context}) => { 
              //    context.spstRef.send({ 
              //      type: "SPEAK", 
              //      value:{ utterance: `Ok. ${context.firmSurface_JSON} When you're ready for the next step, say "next" or "ready".`}
              //    });
              //  },
              //  on: { SPEAK_COMPLETE: "Repeat" }, //Repeat
              //},
              firmSurface: {
                entry: [
                ({ context}) => { 
                  context.spstRef.send({ 
                    type: "SPEAK", 
                    value:{ utterance: `Ok. ${context.firmSurface_JSON.instruction} When you're ready for the next step, say "next" or "ready".`}
                  });
                },
                ({ context }) => {
                  const mediaElement = document.getElementById('instructionMedia');
                  mediaElement.src = context.firmSurface_JSON.mediaUrl;
                  mediaElement.style.display = 'block';
                }
              ],
                on: { SPEAK_COMPLETE: "Next_2" }, //Repeat
              },
              Next_2: {
                entry: listen(),
                on: { 
                  RECOGNISED: [
                    {
                      target: "placingFingers",
                      cond: ({ event }) => event.value.toLowerCase() === "next" || event.value.toLowerCase() === "ready",
                    },
                    {
                      target: "RepeatStep_2",
                    }
                  ],
                },
              },
              RepeatStep_2: {
                entry: ({ context}) => { 
                  context.spstRef.send({ 
                    type: "SPEAK", 
                    value:{ utterance: `Do you want me to repeat the step? Say "yes" or  "no"`}
                  });
                },
                on: { SPEAK_COMPLETE: "RepYesOrNo_2" }, //Repeat
              },
              RepYesOrNo_2: {
                entry: listen(),
                on: { 
                  RECOGNISED: [
                    {
                      target: "firmSurface",
                      cond: ({ event }) => event.value.toLowerCase() === "yes",
                    },
                    {
                      target: "placingFingers",
                      cond: ({ event }) => event.value.toLowerCase() === "no",
                    },
                  ],
                },
              },
              placingFingers: {
                entry: [
                  ({ context}) => { 
                    context.spstRef.send({ 
                      type: "SPEAK", 
                      value:{ utterance: `Now, ${context.placingFingers_JSON.instruction} When you're ready for the next step, say "next" or "ready".`}
                    });
                  },
                  ({ context }) => {
                    const mediaElement = document.getElementById('instructionMedia');
                    mediaElement.src = context.placingFingers_JSON.mediaUrl;
                    mediaElement.style.display = 'block';
                  }
                ],
                  on: { SPEAK_COMPLETE: "Next_2" }, //Repeat
              },
              Repeat: {
                entry: ({ context }) => {
                  context.spstRef.send({
                    type: "SPEAK",
                    value: { utterance: context.lastResult[0].utterance },
                  });
                },
                on: { SPEAK_COMPLETE: "Ask" },
              },
              IdleEnd: {},
            },
          },
        },
      },
      GUI: {
        initial: "PageLoaded",
        states: {
          PageLoaded: {
            entry: "gui.PageLoaded",
            on: { CLICK: { target: "Inactive", actions: "prepare" } },
          },
          Inactive: { entry: "gui.Inactive", on: { ASRTTS_READY: "Active" } },
          Active: {
            initial: "Idle",
            states: {
              Idle: {
                entry: "gui.Idle",
                on: { TTS_STARTED: "Speaking", ASR_STARTED: "Listening" },
              },
              Speaking: {
                entry: "gui.Speaking",
                on: { SPEAK_COMPLETE: "Idle" },
              },
              Listening: { entry: "gui.Listening", on: { RECOGNISED: "Idle" } },
            },
          },
        },
      },
    },
  },
  {
    // custom actions
    //
    actions: {
      prepare: ({ context }) =>
        context.spstRef.send({
          type: "PREPARE",
        }),
      // saveLastResult:
      "speak.greeting": ({ context }) => {
        context.spstRef.send({
          type: "SPEAK",
          value: { utterance: "Hi!" },
        });
      },
      "speak.how-can-I-help": ({ context }) =>
        context.spstRef.send({
          type: "SPEAK",
          value: { utterance: "How can I help you?" },
        }),
      "gui.PageLoaded": ({}) => {
        document.getElementById("button").innerText = "Click to start!";
      },
      "gui.Inactive": ({}) => {
        document.getElementById("button").innerText = "Inactive";
      },
      "gui.Idle": ({}) => {
        document.getElementById("button").innerText = "Idle";
      },
      "gui.Speaking": ({}) => {
        document.getElementById("button").innerText = "Speaking...";
      },
      "gui.Listening": ({}) => {
        document.getElementById("button").innerText = "Listening...";
      },
    },
  },
);

const actor = createActor(dmMachine).start();

document.getElementById("button").onclick = () => actor.send({ type: "CLICK" });

actor.subscribe((state) => {
  console.log(state.value);
});