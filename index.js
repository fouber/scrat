var fis = module.exports = require('fis');
fis.require.prefixes = [ 'scrat', 'fis' ];
fis.cli.name = 'scrat';
fis.cli.info = fis.util.readJSON(__dirname + '/package.json');

function createUAEFiles(ret){
    var root = fis.project.getProjectPath();
    //create conf/config.jsion
    var uae_conf = fis.config.get('uae_conf', {});
    fis.util.map(uae_conf, function(name, conf){
        var file = fis.file(root, 'conf', name + '.json');
        file.setContent(JSON.stringify(conf, null, 4));
        ret.pkg[file.subpath] = file;
    });
    //create private/log
    if(!ret.src['/private/log/log']){
        var file = fis.file(root, 'private/log/log');
        file.setContent('');
        ret.pkg[file.subpath] = file;
    }
}

function readJSON(content, path){
    try {
        return JSON.parse(content);
    } catch (e){
        fis.log.error('invalid json file [' + path + '] : ' + e.message);
    }
}

function makeComponentModulesAlias(componentFile, map, ret) {
    if(componentFile){
        var json = readJSON(componentFile.getContent(), componentFile.subpath);
        fis.util.map(json.dependencies, function(name, version){
            if(/^\d+(\.\d+){2}$/.test(version)){
                var module_name = name.toLowerCase().split('/').join('-');
                var dirname = '/component_modules/' + module_name + '/' + version + '/';
                var file = componentFile = ret.src[dirname + 'component.json'];
                var alias = name;
                if(file){
                    var json = readJSON(file.getContent(), file.subpath);
                    alias = json.name || alias;
                    if(json.main){
                        if(file = ret.src[dirname + json.main]){
                            map.alias[alias] = file.getId();
                        } else {
                            fis.log.error('missing main file [' + json.main + '] of module [' + name + ']');
                        }
                    } else if(file = ret.src[dirname + 'index.js']){
                        map.alias[alias] = file.getId();
                    } else if(file = ret.src[dirname + 'index.css']){
                        map.alias[alias] = file.getId();
                    } else {
                        fis.log.error('can`t find module [' + name + '@' + version + '] main file');
                    }
                } else if(file = ret.src[dirname + 'index.js']){
                    map.alias[alias] = file.getId();
                } else if(file = ret.src[dirname + module_name + '.js']){
                    map.alias[alias] = file.getId();
                } else if(file = ret.src[dirname + 'index.css']){
                    map.alias[alias] = file.getId();
                } else if(file = ret.src[dirname + module_name + '.css']){
                    map.alias[alias] = file.getId();
                } else {
                    fis.log.error('can`t find module [' + name + '@' + version + '] in [/component.json]');
                }
                makeComponentModulesAlias(componentFile, map, ret);
            } else {
                fis.log.error('invalid version [' + version + '] of component [' + name + ']');
            }
        });
    }
}

function coverGlobalDeps(content,srcMap,optimize){   //覆盖全局的alias以及deps对象  
    var deps = getDirectDeps(content);
    var filterAlias ={};
    var filterDeps = {};
    var map = shallowclone(srcMap);

    deps.forEach(function(v,k){        
        addAliasRecursion(filterAlias,filterDeps,srcMap,v);
    });

    map.alias = filterAlias;
    map.deps  = filterDeps;    

    return JSON.stringify(map, null, optimize ? null : 4);
}

function shallowclone(srcMap){
    var o =  {};

    for(var k in srcMap){
        o[k] = srcMap[k];
    }
    return o;
}

function addAliasRecursion(targetAlias,targetDeps,map,key){ //递归添加别名项
    
    if(typeof(targetAlias[key]) === "undefined"){
        targetAlias[key] = map.alias[key];
        addDepsRecursion(targetAlias,targetDeps,map,map.alias[key]);
    }
}

function addDepsRecursion(targetAlias,targetDeps,map,key){   //递归添加依赖项
    var deps  = map.deps;
    var tmp   = deps[key];
    var alias = map.alias;

    if(typeof(tmp) !== "undefined"){
        targetDeps[key] = tmp;

        tmp.forEach(function(v,k){

            if(typeof(alias[v]) !== "undefined"){
                addAliasRecursion(targetAlias,targetDeps,map,v);
            }else{
                addDepsRecursion(targetAlias,targetDeps,map,v);
            }            
        });
    }   
}

function getDirectDeps(content){    //获取页面内容的直接依赖项
    var reg = /(require\.async\(\[*([\w\W]*?)\]|require\.async\(([\w\W]*?),)/;

    if(reg.test(content)){
        var deps = RegExp.$2||RegExp.$3;

        deps = deps.replace(/'|"/g,"").split(",");
        deps = deps.filter(function(v,k){
            return v.replace(/\s/g,"") != "";
        });

        return deps;
    }
    return [];
}

function createResourceMap(ret, conf, settings, opt){
    var map = fis.config.get('framework', {});
    var aliasConfig = map.alias || {};
    map.version = fis.config.get('version');
    map.name = fis.config.get('name');
    map.combo = !!opt.pack;
    map.urlPattern = map.urlPattern || '/c/%s';
    map.comboPattern = map.comboPattern || '/??%s';
    if(opt.md5){
        map.hash = map.hash || fis.util.md5(Date.now() + '-' + Math.random());
    }
    map.alias = {};
    map.deps = {};
    makeComponentModulesAlias(ret.src['/component.json'], map, ret);
    fis.util.map(aliasConfig, function(name, subpath){
        var file = ret.src['/' + subpath.replace(/^\//, '')];
        if(file){
            map.alias[name] = file.getId();
        } else {
            map.alias[name] = subpath;
        }
    });
    var aliased = {};
    fis.util.map(map.alias, function(alias, id){
        aliased[id] = alias;
    });
    var views = [];
    fis.util.map(ret.src, function(subpath, file){
        var id = file.getId();
        if(file.basename.toLowerCase() === 'component.json'){
            file.release = false;
            delete ret.src[subpath];
        } else if(file.isViews && file.isText()){
            views.push(file);
        } else if(file.isComponent && file.isJsLike){
            var match = file.subpath.match(/^\/components\/(.*?([^\/]+))\/\2\.js$/i);
            if(match && match[1] && !map.alias.hasOwnProperty(match[1])){
                map.alias[match[1]] = id;
            }
            if(file.requires.length){
                map.deps[id] = file;
            }
        } else if(id in aliased){
            if(file.requires.length){
                map.deps[id] = file;
            }
        }
    });
    aliased = {};
    fis.util.map(map.alias, function(alias, id){
        aliased[id] = alias;
    });
    fis.util.map(map.deps, function(id, file){
        var deps = [];
        file.requires.forEach(function(depId){
            if(map.alias.hasOwnProperty(depId)){
                deps.push(depId);
            } else if(aliased.hasOwnProperty(depId)){
                deps.push(aliased[depId]);
            } else if(ret.ids.hasOwnProperty(depId)) {
                deps.push(depId);
            } else {
                fis.log.warning('undefined module [' + depId + '] require from [' + file.subpath + ']');
            }
        });
        if(deps.length){
            map.deps[id] = deps;
        } else {
            delete map.deps[id];
        }
    });
    var stringify = JSON.stringify(map, null, opt.optimize ? null : 4);
    views.forEach(function(file){
        //file.setContent(file.getContent().replace(/\b__FRAMEWORK_CONFIG__\b/g, stringify));
        
        file.setContent(file.getContent().replace(/\b__FRAMEWORK_CONFIG__\b/g,
            coverGlobalDeps(file.getContent(),map,opt.optimize)));
    });
}

fis.config.set('project.fileType.text', 'handlebars, jade, ejs, jsx, styl');
fis.config.set('modules.postprocessor.js', function(content, file){
    if(file.isMod){
        content = 'define(\'' + file.getId() + '\', function(require, exports, module){' + content + '\n\n});';
    }
    return content;
});
fis.config.set('modules.parser.handlebars', 'handlebars');
fis.config.set('modules.parser.styl', 'stylus');
fis.config.set('modules.postpackager', [ createUAEFiles, createResourceMap ]);
fis.config.set('roadmap.ext.jsx', 'js');
fis.config.set('roadmap.ext.styl', 'css');
fis.config.set('urlPrefix', '');
fis.config.set('roadmap.path', [
    {
        reg : '**.handlebars',
        release : false,
        isJsLike : true
    },
    {
        reg : '**.md',
        release : false,
        isHtmlLike : true
    },
    {
        reg : /\.inline\.\w+$/i,
        release : false
    },
    {
        reg : '**.jade'
    },
    {
        reg : /^\/component_modules\/(.*\.tpl)$/i,
        isHtmlLike : true,
        release : '/views/c/$1'
    },
    {
        reg : /^\/components\/(.*\.tpl)$/i,
        isHtmlLike : true,
        release : '/views/c/${name}/${version}/$1'
    },
    {
        reg : /^\/views\/(.*\.tpl)$/,
        useCache : false,
        isViews : true,
        isHtmlLike : true,
        release : '/views/${name}/${version}/$1'
    },
    {
        reg : /^\/component_modules\/(.*)\.(styl|css)$/i,
        id : '$1.css',
        isMod : true,
        useSprite : true,
        useHash : false,
        url : '${urlPrefix}/c/$1.$2',
        release : '/public/c/$1.$2'
    },
    {
        reg : /^\/component_modules\/(.*\.js)$/i,
        id : '$1',
        isMod : true,
        useHash : false,
        url : '${urlPrefix}/c/$1',
        release : '/public/c/$1'
    },
    {
        reg : /^\/component_modules\/(.*)$/i,
        url : '${urlPrefix}/c/$1',
        release : '/public/c/$1'
    },
    {
        reg : /^\/components\/(.*)\.(styl|css)$/i,
        id : '${name}/${version}/$1.css',
        isMod : true,
        useSprite : true,
        useHash : false,
        url : '${urlPrefix}/c/${name}/${version}/$1.$2',
        release : '/public/c/${name}/${version}/$1.$2'
    },
    {
        reg : /^\/components\/(.*\.js)$/i,
        id : '${name}/${version}/$1',
        isMod : true,
        isComponent : true,
        useHash : false,
        url : '${urlPrefix}/c/${name}/${version}/$1',
        release : '/public/c/${name}/${version}/$1'
    },
    {
        reg : /^\/components\/(.*)$/i,
        url : '${urlPrefix}/c/${name}/${version}/$1',
        release : '/public/c/${name}/${version}/$1'
    },
    {
        reg : /^\/views\/(.*\.(?:html?|js))$/,
        useCache : false,
        isViews : true,
        url : '${urlPrefix}/${name}/${version}/$1',
        release : '/public/${name}/${version}/$1'
    },
    {
        reg : /^\/views\/(.*)$/,
        useSprite : true,
        isViews : true,
        url : '${urlPrefix}/${name}/${version}/$1',
        release : '/public/${name}/${version}/$1'
    },
    {
        reg : /^\/public\/(.*)$/,
        useSprite : true,
        url : '${urlPrefix}/${name}/${version}/$1',
        release : '/public/${name}/${version}/$1'
    },
    {
        reg : 'map.json',
        release : false
    },
    {
        reg : '**',
        useHash : false,
        useCompile : false
    }
]);

//default uae config
fis.config.set('uae_conf.config', {
    description: 'UAE 会自动修改这个文件中的配置，请勿手工修改',
    memcached : [{
        name : '',
        host : '127.0.0.1',
        port : 11211
    }]
});

//alias
Object.defineProperty(global, 'scrat', {
    enumerable : true,
    writable : false,
    value : fis
});
