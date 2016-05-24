/*
 * OpenComputers-3D-Designer - OpenComputers 3D printer scripts (.3dm) viewer/editor
 *
 * Copyright (c) 2015 Kevin Velickovic
 *
 *
 * Author(s):
 *
 *      Kevin Velickovic <k.velickovic@gmail.com>
 *
 * Contributor(s):
 *
 *      Nopey <golgothasTerror101@gmail.com>
 *
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 *
 * Additional Terms:
 *
 *      You are required to preserve legal notices and author attributions in
 *      that material or in the Appropriate Legal Notices displayed by works
 *      containing it.
 */

var JLua = null;
var camera, scene, renderer;
var resourcepack = 'Vanilla';
var resourcepack_alpha = true;
var resourcepack_nearestfilter = true;
var current_state = false;
var editor = null;
var ground_mesh = null;
var needs_update = false;

var raycaster = new THREE.Raycaster();
var mouse = new THREE.Vector2();
var highlightedLine = null;
var highlightedLineTimeout = null;

var sel_block = null;
var sel_block_mat = new THREE.MeshBasicMaterial({
    color: 0xEC4C4C,
    wireframe: true
});

function luavm_init()
{
    JLua = new Lua.State();
    $.get( "js/lib/lua/dkjson.lua", function( data ) {
    JLua_g_data = data;
    JLua.execute('h = io.open("/dkjson.lua", "w"); h:write(js.global.JLua_g_data); h:close()');
    JLua.execute('json = require("dkjson")');

    });
}

function luavm_decode( input )
{
    var json_data = JLua.execute('return json.encode (' + input + ', { indent = false })')[ 0 ];

    if( json_data )
    {
    var json_obj = JSON.parse( json_data );

    $.each(json_obj.shapes, function(index, value) {
        if( value.state )
            json_obj.state_block = true;

        if( !value.tint )
            value.tint = 0xffffff;
    });

    return json_obj;
    }
}

$( document ).ready(function() {

    editor = ace.edit("editor");
    editor.setTheme("ace/theme/monokai");
    editor.getSession().setMode("ace/mode/lua");
    editor.getSession().setUseWorker(false);
    editor.$blockScrolling = Infinity;

    editor.on('input', function() {
        change_event( editor.getValue() );
    });

    editor.on('changeSelection', function() {
        var currline = editor.getSelectionRange().start.row;
        var wholelinetxt = editor.session.getLine(currline);
        change_cursor_event( wholelinetxt );
    });

    var resourcepack_select = $("#resourcepack select");
    var alpha_checkbox = $("#resourcepack #alphaenabled");
    var nearestfilter_checkbox = $("#resourcepack #nearestfilterenabled");
    var template_select = $("#template select");

    resourcepack_select.prop('selectedIndex',0);
    template_select.prop('selectedIndex',0);

    resourcepack_select.on('change', function() {
        resourcepack = resourcepack_select.val();
        buildGround();

        if( editor.getValue().length > 0 )
            change_event( editor.getValue() );
    });

    template_select.on('change', function() {
        var template = template_select.val();

        $.get( "templates/" + template, function( data ) {
            change_event( data );
            editor.setValue( data, -1 );
            editor.resize();
        });
    });

    alpha_checkbox.on('change', function() {
        resourcepack_alpha = alpha_checkbox.prop('checked');
        renderer.sortObjects = !resourcepack_alpha;
        if( editor.getValue().length > 0 )
            change_event( editor.getValue() );
    });

    nearestfilter_checkbox.on('change', function() {
        resourcepack_nearestfilter = nearestfilter_checkbox.prop('checked');
        buildGround();
        if( editor.getValue().length > 0 )
            change_event( editor.getValue() );
    });
    resourcepack_nearestfilter = nearestfilter_checkbox.prop('checked');

    $("#statetoggle").on('click', function() {
        var audio = new Audio('sounds/click.ogg');
        audio.play();
        current_state = !current_state;
        change_event( editor.getValue() );
    });

    new ResizeSensor($('#editor'), function() {
        editor.resize();
    });

    luavm_init();
    init();
    render();
});

function pad(n, width, z) {
    z = z || '0';
    n = n + '';
    return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
}

function clamp(val, min, max)
{
    var clamped = ( val > max ? max : val );
    clamped = ( clamped < min ? min : clamped );

    return clamped;
}

function buildGround()
{
    if( ground_mesh )
        scene.remove( ground_mesh );

    var texture_side = THREE.ImageUtils.loadTexture( ( 'img/resourcepacks/' + resourcepack + '/blocks/grass_side.png' ), null, onTextureLoaded );
    var texture_top  = THREE.ImageUtils.loadTexture( ( 'img/resourcepacks/' + resourcepack + '/blocks/grass_top.png' ), null, onTextureLoaded );
    var texture_bot  = THREE.ImageUtils.loadTexture( ( 'img/resourcepacks/' + resourcepack + '/blocks/dirt.png' ), null, onTextureLoaded );
    if(resourcepack_nearestfilter){
        texture_side.magFilter = THREE.NearestFilter;
        texture_top.magFilter = THREE.NearestFilter;
        texture_bot.magFilter = THREE.NearestFilter;
    }

    texture_side.wrapS = THREE.RepeatWrapping;
    texture_side.wrapT = THREE.RepeatWrapping;
    texture_side.repeat.set( 3, 1 );

    texture_top.wrapS = THREE.RepeatWrapping;
    texture_top.wrapT = THREE.RepeatWrapping;
    texture_top.repeat.set( 3, 3 );

    texture_bot.wrapS = THREE.RepeatWrapping;
    texture_bot.wrapT = THREE.RepeatWrapping;
    texture_bot.repeat.set( 3, 3 );

    var object_materials = [
        new THREE.MeshPhongMaterial( { map: texture_side, transparent: resourcepack_alpha } ),
        new THREE.MeshPhongMaterial( { map: texture_side, transparent: resourcepack_alpha } ),
        new THREE.MeshPhongMaterial( { map: texture_top, transparent: resourcepack_alpha, color: 0x48B518 } ),
        new THREE.MeshPhongMaterial( { map: texture_bot, transparent: resourcepack_alpha } ),
        new THREE.MeshPhongMaterial( { map: texture_side, transparent: resourcepack_alpha } ),
        new THREE.MeshPhongMaterial( { map: texture_side, transparent: resourcepack_alpha } )
    ]
    var object_meshFaceMaterial = new THREE.MeshFaceMaterial( object_materials );

    ground_mesh = new THREE.Mesh(
        new THREE.BoxGeometry(48, 16, 48),
        object_meshFaceMaterial
    );

    ground_mesh.position.set( 0, -16, 0 );

    scene.add( ground_mesh );
    render();
}

function create_part( i_pos_1, i_pos_2, i_pos_3, i_size_1, i_size_2, i_size_3, texture, tint, state, mat_o )
{
    var size_1 = ( i_size_1 - i_pos_1 );
    var size_2 = ( i_size_2 - i_pos_2 );
    var size_3 = ( i_size_3 - i_pos_3 );

    geometry = new THREE.BoxGeometry(size_1, size_2, size_3 );

    geometry.computeBoundingBox();
    geometry.faceVertexUvs = [[]];

    var scale_X = ( geometry.boundingBox.size().x / 16.0 );
    var scale_Y = ( geometry.boundingBox.size().y / 16.0 );
    var scale_Z = ( geometry.boundingBox.size().z / 16.0 );

    var texture_path = ( texture ? 'img/resourcepacks/' + resourcepack + '/blocks/' + texture + '.png' : 'img/grid.png' );

    var loaded_textures = [];
    for(i = 0; i < 6; i++)
    {
        loaded_textures.push( THREE.ImageUtils.loadTexture(texture_path, null, onTextureLoaded) );
        if(resourcepack_nearestfilter)
            loaded_textures[ i ].magFilter = THREE.NearestFilter;
        loaded_textures[ i ].anisotropy = 0;
    }

    var object_materials = [
        new THREE.MeshPhongMaterial( { map: loaded_textures[ 0 ], transparent: resourcepack_alpha, color: tint } ),
        new THREE.MeshPhongMaterial( { map: loaded_textures[ 1 ], transparent: resourcepack_alpha, color: tint } ),
        new THREE.MeshPhongMaterial( { map: loaded_textures[ 2 ], transparent: resourcepack_alpha, color: tint } ),
        new THREE.MeshPhongMaterial( { map: loaded_textures[ 3 ], transparent: resourcepack_alpha, color: tint } ),
        new THREE.MeshPhongMaterial( { map: loaded_textures[ 4 ], transparent: resourcepack_alpha, color: tint } ),
        new THREE.MeshPhongMaterial( { map: loaded_textures[ 5 ], transparent: resourcepack_alpha, color: tint } )
    ]
    object_meshFaceMaterial = new THREE.MeshFaceMaterial( object_materials );

    var mesh = new THREE.Mesh( geometry, ( mat_o ? mat_o : object_meshFaceMaterial  ) );

    mesh.position.set(
        ( -8 + ( size_1 / 2 ) ) + i_pos_1,
        ( -8 + ( size_2 / 2 ) ) + i_pos_2,
        ( -( -8 + ( size_3 / 2 ) ) ) - i_pos_3
    );

    mesh.updateMatrixWorld();

    var world_scale_front  = ( 8 - mesh.geometry.vertices[ 0 ].clone().applyMatrix4( mesh.matrixWorld ).x ) / 16.0;
    var world_scale_back   = ( 8 + mesh.geometry.vertices[ 4 ].clone().applyMatrix4( mesh.matrixWorld ).x ) / 16.0;
    var world_scale_bottom = ( 8 + mesh.geometry.vertices[ 2 ].clone().applyMatrix4( mesh.matrixWorld ).y ) / 16.0;
    var world_scale_left   = ( 8 - mesh.geometry.vertices[ 0 ].clone().applyMatrix4( mesh.matrixWorld ).z ) / 16.0;
    var world_scale_right  = ( 8 + mesh.geometry.vertices[ 1 ].clone().applyMatrix4( mesh.matrixWorld ).z ) / 16.0;

    loaded_textures[ 0 ].offset.x = world_scale_left;
    loaded_textures[ 0 ].offset.y = world_scale_bottom;

    loaded_textures[ 1 ].offset.x = world_scale_right;
    loaded_textures[ 1 ].offset.y = world_scale_bottom;

    loaded_textures[ 2 ].offset.y = world_scale_left;
    loaded_textures[ 2 ].offset.x = world_scale_back;

    loaded_textures[ 3 ].offset.y = world_scale_right;
    loaded_textures[ 3 ].offset.x = world_scale_back;

    loaded_textures[ 4 ].offset.x = world_scale_back;
    loaded_textures[ 4 ].offset.y = world_scale_bottom;

    loaded_textures[ 5 ].offset.x = world_scale_front;
    loaded_textures[ 5 ].offset.y = world_scale_bottom;

    geometry.faceVertexUvs[0].push( [
        new THREE.Vector2(0, scale_Y),
        new THREE.Vector2(0, 0),
        new THREE.Vector2(scale_Z, scale_Y)
    ] );
    geometry.faceVertexUvs[0].push( [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(scale_Z, 0),
        new THREE.Vector2(scale_Z, scale_Y)
    ] );

    geometry.faceVertexUvs[0].push( [
        new THREE.Vector2(0, scale_Y),
        new THREE.Vector2(0, 0),
        new THREE.Vector2(scale_Z, scale_Y)
    ] );
    geometry.faceVertexUvs[0].push( [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(scale_Z, 0),
        new THREE.Vector2(scale_Z, scale_Y)
    ] );

    geometry.faceVertexUvs[0].push( [
        new THREE.Vector2(0, scale_Z),
        new THREE.Vector2(0, 0),
        new THREE.Vector2(scale_X, scale_Z)
    ] );
    geometry.faceVertexUvs[0].push( [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(scale_X, 0),
        new THREE.Vector2(scale_X, scale_Z)
    ] );

    geometry.faceVertexUvs[0].push( [
        new THREE.Vector2(0, scale_Z),
        new THREE.Vector2(0, 0),
        new THREE.Vector2(scale_X, scale_Z)
    ] );
    geometry.faceVertexUvs[0].push( [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(scale_X, 0),
        new THREE.Vector2(scale_X, scale_Z)
    ] );

    geometry.faceVertexUvs[0].push( [
        new THREE.Vector2(0, scale_Y),
        new THREE.Vector2(0, 0),
        new THREE.Vector2(scale_X, scale_Y)
    ] );
    geometry.faceVertexUvs[0].push( [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(scale_X, 0),
        new THREE.Vector2(scale_X, scale_Y)
    ] );

    geometry.faceVertexUvs[0].push( [
        new THREE.Vector2(0, scale_Y),
        new THREE.Vector2(0, 0),
        new THREE.Vector2(scale_X, scale_Y)
    ] );
    geometry.faceVertexUvs[0].push( [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(scale_X, 0),
        new THREE.Vector2(scale_X, scale_Y)
    ] );

    geometry.uvsNeedUpdate = true;

    return mesh;
}

function parse_line_coords( line )
{
    var coords_exp  = /\{\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+).*\"/g;
    coords_exp_match = coords_exp.exec( line );

    if( coords_exp_match )
    {
        return [
            parseInt( coords_exp_match[ 1 ] ),
            parseInt( coords_exp_match[ 2 ] ),
            parseInt( coords_exp_match[ 3 ] ),
            parseInt( coords_exp_match[ 4 ] ),
            parseInt( coords_exp_match[ 5 ] ),
            parseInt( coords_exp_match[ 6 ] )
        ]
    }

}

function change_cursor_event( line ){

    var line_coords = parse_line_coords( line );

    if( line_coords )
    {
        $.each(scene_objects, function(index, value) {
            var block = value[ 0 ];
            var block_data = value[ 1 ];

            if( block_data[ 1 ] == line_coords[ 0 ]
                && block_data[ 2 ] == line_coords[ 1 ]
                && block_data[ 3 ] == line_coords[ 2 ]
                && block_data[ 4 ] == line_coords[ 3 ]
                && block_data[ 5 ] == line_coords[ 4 ]
                && block_data[ 6 ] == line_coords[ 5 ] )
            {

                if( sel_block )
                {
                    scene.remove( sel_block );
                    sel_block = null;
                }

                sel_block = create_part(
                    block_data[ 1 ],
                    block_data[ 2 ],
                    block_data[ 3 ],
                    block_data[ 4 ],
                    block_data[ 5 ],
                    block_data[ 6 ],
                    null,
                    null,
                    true,
                    sel_block_mat
                );

                scene.add( sel_block );
                render();
            }
        });

    } else {
        if( sel_block )
        {
            scene.remove( sel_block );
            sel_block = null;
        }
    }

}

function change_event( content ){

    var block = luavm_decode( content );

    if( block.state_block )
        $("#statetoggle").attr("disabled", false);
    else
        $("#statetoggle").attr("disabled", true);

    $.each(scene_objects, function(index, value) {
        scene.remove( value[ 0 ] );
    });

    geoms = [];

    $.each(block.shapes, function(index, value) {

        var clamped_values = [
            clamp( value[ 1 ], 0, 16 ),
            clamp( value[ 2 ], 0, 16 ),
            clamp( value[ 3 ], 0, 16 ),
            clamp( value[ 4 ], 0, 16 ),
            clamp( value[ 5 ], 0, 16 ),
            clamp( value[ 6 ], 0, 16 )
        ];

        var padded_values = [];

        $.each(clamped_values, function(index, value_i) {
            padded_values.push( pad( value_i, 2 ) );
        });

        var visibility = false;

        if( block.state_block )
        {
            if( value.state )
            {
                if( current_state )
                {
                    visibility = true;
                }
            } else {
                if( ! current_state )
                {
                    visibility = true;
                }
            }
        } else {
            visibility = true;
        }

        if( visibility )
        {
            var obj = create_part(
                clamped_values[ 0 ],
                clamped_values[ 1 ],
                clamped_values[ 2 ],
                clamped_values[ 3 ],
                clamped_values[ 4 ],
                clamped_values[ 5 ],
                value.texture,
                value.tint,
                value.state
            );

            obj.config = value;

            scene_objects.push( [obj, value] );
            scene.add( obj );
        }

    });

    render();

}

function onMouseDown( event ) {
    // calculate mouse position in normalized device coordinates
    // (-1 to +1) for both components

    mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
    mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;

    // update the picking ray with the camera and mouse position
    raycaster.setFromCamera( mouse, camera );

    // calculate objects intersecting the picking ray
    var intersects = raycaster.intersectObjects( scene.children );
    var intersects_object = null;

    for ( var i = 0; i < intersects.length; i++ ) {

        if( intersects[ i ].object.uuid != bounds_mesh.uuid )
        {
            intersects_object = intersects[ i ].object;
            break;
        }

    }

    if( intersects_object )
    {
        if( highlightedLineTimeout )
        {
            clearTimeout( highlightedLineTimeout );
        }

        var lines = editor.getValue().split('\n');

        for(var i = 0;i < lines.length;i++){

            var line_coords = parse_line_coords( lines[ i ] );

            if( line_coords )
            {
                if( intersects_object.config )
                {
                    if( intersects_object.config[ 1 ] == line_coords[ 0 ]
                        && intersects_object.config[ 2 ] == line_coords[ 1 ]
                        && intersects_object.config[ 3 ] == line_coords[ 2 ]
                        && intersects_object.config[ 4 ] == line_coords[ 3 ]
                        && intersects_object.config[ 5 ] == line_coords[ 4 ]
                        && intersects_object.config[ 6 ] == line_coords[ 5 ] )
                    {
                        var target_line = ( i + 1 );

                        editor.gotoLine(target_line, 0, true);
                        highlightLine(target_line);
                        highlightedLineTimeout = setTimeout(function(){
                            unhighlightLine();
                        }, 1000);
                    };
                }
            }
        };
    } else {
        editor.gotoLine(0, 0, true);
    }

}

function highlightLine(lineNumber) {
      unhighlightLine();
      var Range = ace.require("ace/range").Range
      highlightedLine = editor.session.addMarker(new Range(lineNumber - 1, 0, lineNumber - 1, 144), "lineHighlight", "fullLine");
}

function unhighlightLine(){
    editor.getSession().removeMarker( highlightedLine );
    highlightedLine = null;
}

function init() {

    scene_objects = [];
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera( 64, window.innerWidth / window.innerHeight, 1, 1000);
    camera.position.z = 45;
    camera.position.y = 45;
    camera.position.x = 45;

    var light = new THREE.DirectionalLight( 0xffffff );
    light.position.set( 1, 1, 1 ).normalize();
    var light2 = new THREE.DirectionalLight( 0xffffff );
    light2.position.set( -1, -1, -1 ).normalize();
    scene.add(light);
    scene.add(light2);

    bounds_geometry = new THREE.BoxGeometry(16, 16, 16);
    bounds_material = new THREE.MeshBasicMaterial({
        color: 0x007cc3,
        wireframe: true
    });

    bounds_mesh = new THREE.Mesh(bounds_geometry, bounds_material );

    scene.add( bounds_mesh );

    renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(new THREE.Color(0xEEEEEE, 1.0));
    renderer.shadowMapEnabled = true;
    renderer.sortObjects = false

    buildGround();

    controls = new THREE.OrbitControls( camera, renderer.domElement );
    controls.noKeys = true;

    document.getElementById("canvas_container").appendChild(renderer.domElement);

    var $canvas = $('#canvas_container canvas');
    $canvas.on('mousedown', function (evt) {
        $canvas.on('mouseup mousemove', function handler(evt) {
            if (evt.type === 'mouseup') {
                onMouseDown( evt );
            }
            $canvas.off('mouseup mousemove', handler);
        });
    });

    $canvas.mousedown(function() {
        needs_update = true;
        render();
    });
    $canvas.mouseup(function() {
        needs_update = false;
    });
    $canvas.bind('mousewheel DOMMouseScroll', function(e){
        render();
    });

    window.addEventListener( 'resize', onWindowResize, false );
}

function render() {
    if(needs_update){
        requestAnimationFrame(render);
        renderer.render(scene, camera);
    } else {
        renderer.render(scene, camera);
    }
}

function onTextureLoaded(texture)
{
    render();
}

function onWindowResize(){
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( window.innerWidth, window.innerHeight );
    render();
}
