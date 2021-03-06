#!/usr/bin/env node
'use strict';

const fs = require('fs');
const util = require('util');
const xml2js = require('xml2js');
const meow = require('meow');

const wfg = {};

wfg.ProtocolParser = class {

    ["uint"](argName, optional) {
        return {
            signature: optional ? "?u" : "u",
            jsType: optional ? "?Number" : "Number",
            marshallGen: optional ? util.format("wfc._uintOptional(%s)", argName) : util.format("wfc._uint(%s)", argName)
        };
    }

    ["int"](argName, optional) {
        return {
            signature: optional ? "?i" : "i",
            jsType: optional ? "?Number" : "Number",
            marshallGen: optional ? util.format("wfc._intOptional(%s)", argName) : util.format("wfc._int(%s)", argName)
        };
    }

    ["fixed"](argName, optional) {
        return {
            signature: optional ? "?f" : "f",
            jsType: optional ? "?Fixed" : "Fixed",
            marshallGen: optional ? util.format("wfc._fixedOptional(%s)", argName) : util.format("wfc._fixed(%s)", argName)
        };
    }

    ["object"](argName, optional) {
        return {
            signature: optional ? "?o" : "o",
            jsType: optional ? "?*" : "*",
            marshallGen: optional ? util.format("wfc._objectOptional(%s)", argName) : util.format("wfc._object(%s)", argName)
        };
    }

    ["new_id"](argName, optional) {
        return {
            signature: optional ? "?n" : "n",
            jsType: "*",
            marshallGen: "wfc._newObject()"
        };
    }

    ["string"](argName, optional) {
        return {
            signature: optional ? "?s" : "s",
            jsType: optional ? "?string" : "string",
            marshallGen: optional ? util.format("wfc._stringOptional(%s)", argName) : util.format("wfc._string(%s)", argName)
        };
    }

    ["array"](argName, optional) {
        return {
            signature: optional ? "?a" : "a",
            jsType: optional ? "?ArrayBuffer" : "ArrayBuffer",
            marshallGen: optional ? util.format("wfc._arrayOptional(%s)", argName) : util.format("wfc._array(%s)", argName)
        };
    }

    _generateRequestArgs(out, req) {
        if (req.hasOwnProperty("arg")) {
            const evArgs = req.arg;
            let processedFirstArg = false;
            for (let i = 0; i < evArgs.length; i++) {
                const arg = evArgs[i];
                if (arg.$.type === "new_id") {
                    continue;
                }

                const argName = arg.$.name;
                if (processedFirstArg) {
                    out.write(", ");
                }
                out.write(argName);
                processedFirstArg = true;
            }
        }
    }

    _generateEventArgs(out, ev) {
        if (ev.hasOwnProperty("arg")) {
            const evArgs = ev.arg;
            for (let i = 0; i < evArgs.length; i++) {
                const arg = evArgs[i];
                const argName = arg.$.name;
                if (i !== 0) {
                    out.write(", ");
                }
                out.write(argName);
            }
        }
    }

    _parseEventSignature(ev) {
        let evSig = "";
        if (ev.hasOwnProperty("arg")) {
            const evArgs = ev.arg;
            for (let i = 0; i < evArgs.length; i++) {
                const arg = evArgs[i];

                const argName = arg.$.name;
                const optional = arg.$.hasOwnProperty("allow-null") && (arg.$["allow-null"] === "true");
                const argType = arg.$.type;

                evSig += this[argType](argName, optional).signature;
            }
        }

        return evSig;
    }

    _generateIfEventGlue(out, ev, opcode) {

        const evName = ev.$.name;

        out.write(util.format("\t[%d](message){\n", opcode));
        const evSig = this._parseEventSignature(ev);
        out.write(util.format("\t\tconst args = this._connection._unmarshallArgs(message,\"%s\");\n", evSig));
        out.write(util.format("\t\tthis.listener.%s.call(this.listener", evName));

        if (ev.hasOwnProperty("arg")) {
            const evArgs = ev.arg;
            for (let i = 0; i < evArgs.length; i++) {
                out.write(", ");
                const arg = evArgs[i];
                const argType = arg.$.type;
                out.write(util.format("args[%d]", i));
                if (argType === "new_id") {
                    const argItf = arg.$["interface"];
                    out.write(util.format("(\"%s\")", argItf));
                }
            }
        }

        out.write(");\n");
        out.write("\t}\n\n");
    }

    _parseItfEvent(out, itfEvent) {
        const sinceVersion = itfEvent.$.hasOwnProperty("since") ? parseInt(itfEvent.$.since) : 1;
        const evName = itfEvent.$.name;

        //function docs
        const description = itfEvent.description;
        description.forEach((val) => {
            out.write("\n\t\t\t/**\n");
            if (val.hasOwnProperty("_")) {
                val._.split("\n").forEach((line) => {
                    out.write("\t\t\t *" + line + "\n");
                });
            }

            if (itfEvent.hasOwnProperty("arg")) {
                const evArgs = itfEvent.arg;
                out.write("\t\t\t *\n");
                evArgs.forEach((arg) => {
                    const argDescription = arg.$.summary;
                    const argName = arg.$.name;
                    const optional = arg.$.hasOwnProperty("allow-null") && (arg.$["allow-null"] === "true");
                    const argType = arg.$.type;

                    out.write(util.format("\t\t\t * @param {%s} %s %s \n", this[argType](argName, optional).jsType, argName, argDescription));
                });
                out.write("\t\t\t *\n");

            }
            out.write(util.format("\t\t\t * @since %d\n", sinceVersion));
            out.write("\t\t\t *\n");
            out.write("\t\t\t */\n");
        });

        //function
        out.write(util.format("\t\t\t%s(", evName));
        this._generateEventArgs(out, itfEvent);
        out.write(") {},\n");
    }

    _parseItfRequest(out, itfRequest, opcode, itfVersion) {

        const sinceVersion = itfRequest.$.hasOwnProperty("since") ? parseInt(itfRequest.$.since) : 1;
        if (sinceVersion !== itfVersion) {
            return;
        }

        const reqName = itfRequest.$.name;

        //function docs
        const description = itfRequest.description;
        description.forEach((val) => {
            out.write("\n\t/**\n");
            if (val.hasOwnProperty("_")) {
                val._.split("\n").forEach((line) => {
                    out.write("\t *" + line + "\n");
                });
            }

            if (itfRequest.hasOwnProperty("arg")) {
                const reqArgs = itfRequest.arg;
                out.write("\t *\n");
                reqArgs.forEach((arg) => {
                    const argDescription = arg.$.summary;
                    const argName = arg.$.name;
                    const optional = arg.$.hasOwnProperty("allow-null") && (arg.$["allow-null"] === "true");
                    const argType = arg.$.type;
                    if (argType !== "new_id") {
                        out.write(util.format("\t * @param {%s} %s %s \n", this[argType](argName, optional).jsType, argName, argDescription));
                    }
                });

                reqArgs.forEach((arg) => {
                    const argDescription = arg.$.summary;
                    const argItf = arg.$["interface"];
                    const argType = arg.$.type;
                    if (argType === "new_id") {
                        out.write(util.format("\t * @return {%s} %s \n", argItf, argDescription));
                    }
                });
                out.write("\t *\n");

            }
            out.write(util.format("\t * @since %d\n", sinceVersion));
            out.write("\t *\n");
            out.write("\t */\n");
        });

        //function
        out.write(util.format("\t%s(", reqName));
        this._generateRequestArgs(out, itfRequest);
        out.write(") {\n");


        let itfName;
        //function args
        let argArray = "[";
        if (itfRequest.hasOwnProperty("arg")) {
            const reqArgs = itfRequest.arg;


            for (let i = 0; i < reqArgs.length; i++) {
                const arg = reqArgs[i];
                const argType = arg.$.type;
                const argName = arg.$.name;
                const optional = arg.$.hasOwnProperty("allow-null") && (arg.$["allow-null"] === "true");

                if (argType === "new_id") {
                    itfName = arg.$["interface"];
                }

                if (i !== 0) {
                    argArray += ", ";
                }

                argArray += this[argType](argName, optional).marshallGen;
            }
        }
        argArray += "]";

        if (itfName) {
            out.write(util.format("\t\treturn this._connection._marshallConstructor(this._id, %d, \"%s\", %s);\n", opcode, itfName, argArray));
        } else {
            out.write(util.format("\t\tthis._connection._marshall(this._id, %d, %s);\n", opcode, argArray));
        }

        out.write("\t}\n");
    }

    _parseInterface(out, protocolItf) {
        const itfName = protocolItf.$.name;
        let itfVersion = 1;

        if (protocolItf.$.hasOwnProperty("version")) {
            itfVersion = parseInt(protocolItf.$.version);
        }

        console.log(util.format("Processing interface %s v%d", itfName, itfVersion));

        for (let i = 1; i <= itfVersion; i++) {

            //class docs
            const description = protocolItf.description;
            if (description) {
                description.forEach((val) => {
                    out.write("\n/**\n");
                    if (val.hasOwnProperty("_")) {
                        val._.split("\n").forEach((line) => {
                            out.write(" *" + line + "\n");
                        });
                    }
                    out.write(" */\n");
                });
            }

            //class
            if (i === 1) {
                out.write(util.format("wfc.%s = class %s extends wfc.WObject {\n", itfName, itfName));
            } else {
                const className = util.format("%sV%d", itfName, i);
                if (i === 2) {
                    out.write(util.format("wfc.%s = class %s extends wfc.%s {\n", className, className, itfName));
                } else {
                    out.write(util.format("wfc.%s = class %s extends wfc.%sV%d {\n", className, className, itfName, i - 1));
                }
            }

            //requests
            if (protocolItf.hasOwnProperty("request")) {
                const itfRequests = protocolItf.request;
                for (let j = 0; j < itfRequests.length; j++) {
                    this._parseItfRequest(out, itfRequests[j], j + 1, i);
                }
            }

            //constructor
            out.write("\n\tconstructor(connection) {\n");
            out.write("\t\tsuper(connection, {\n");
            out.write(util.format("\t\t\tname: \"%s\",\n", itfName));
            out.write(util.format("\t\t\tversion: %d,\n", i));
            //events
            if (protocolItf.hasOwnProperty("event")) {

                const itfEvents = protocolItf.event;
                for (let j = 0; j < itfEvents.length; j++) {
                    const itfEvent = itfEvents[j];
                    let since = "1";
                    if (itfEvent.$.hasOwnProperty("since")) {
                        since = itfEvent.$.since;
                    }

                    if (parseInt(since) <= i) {
                        this._parseItfEvent(out, itfEvent);
                    }
                }
            }
            out.write("\t\t});\n");
            out.write("\t}\n\n");

            //glue event functions
            if (protocolItf.hasOwnProperty("event")) {
                const itfEvents = protocolItf.event;
                for (let j = 0; j < itfEvents.length; j++) {
                    const itfEvent = itfEvents[j];
                    let since = "1";
                    if (itfEvent.$.hasOwnProperty("since")) {
                        since = itfEvent.$.since;
                    }

                    if (parseInt(since) === i) {
                        this._generateIfEventGlue(out, itfEvent, j + 1);
                    }
                }
            }

            out.write("};\n");
        }
    }

    _parseProtocol(jsonProtocol) {
        const protocolName = jsonProtocol.protocol.$.name;
        const out = fs.createWriteStream(util.format("westfield-client-%s.js", protocolName));
        out.on('open', (fd) => {
            out.write("/*\n");
            jsonProtocol.protocol.copyright.forEach((val) => {
                val.split("\n").forEach((line) => {
                    out.write(" *" + line + "\n");
                });
            });
            out.write(" */\n");

            jsonProtocol.protocol.interface.forEach((itf) => {
                this._parseInterface(out, itf);
            });

            console.log('Done');
        });
    }

    parse() {
        fs.readFile(this.protocolFile, (err, data) => {
            if (err) throw err;
            new xml2js.Parser().parseString(data, (err, result) => {
                if (err) throw err;

                //uncomment to see the protocol as json output
                //console.log(util.inspect(result, false, null));

                this._parseProtocol(result);
            });
        });
    }

    constructor(protocolFile) {
        this.protocolFile = protocolFile;
    }
};

const cli = meow(`Usage:
        westfield-scanner.js FILE... [options]

    Generates a javascript protocol file based on the given FILE argument.
    The FILE argument is a relative or absolute path to a Westfield compatible Wayland XML.
    The generated javascript protocol file is named "westfield-client-FILE.js".

    Options:
        -h, --help         print usage information
        -v, --version      show version info and exit
        
`, {});

cli.input.forEach((protocol) => {
    new wfg.ProtocolParser(protocol).parse();
});
