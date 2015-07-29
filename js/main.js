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

var camera, scene, renderer;
var geometry, material, mesh;
var resourcepack = 'Vanilla';
var resourcepack_alpha = true;
var current_state = false;
var editor = null;

var raycaster = new THREE.Raycaster();
var mouse = new THREE.Vector2();
var highlightedLine = null;
var highlightedLineTimeout = null;

var sel_block = null;
var sel_block_mat = new THREE.MeshBasicMaterial({
	color: 0xEC4C4C,
	wireframe: true
});

$( document ).ready(function() {
	init();
	animate();
	
	editor = ace.edit("editor");
	editor.setTheme("ace/theme/monokai");
	editor.getSession().setMode("ace/mode/lua");
	editor.getSession().setUseWorker(false);
	editor.$blockScrolling = Infinity;
			
	editor.on('input', function() {
		change_event( editor.getValue() );
		
		var currline = editor.getSelectionRange().start.row;
		var wholelinetxt = editor.session.getLine(currline);
		var selected_item = parse_luaserialize(wholelinetxt);
		
		change_cursor_event( selected_item );
	});

	editor.on('changeSelection', function() {
		var currline = editor.getSelectionRange().start.row;
		var wholelinetxt = editor.session.getLine(currline);
		var selected_item = parse_luaserialize(wholelinetxt);
		
		change_cursor_event( selected_item );
	});
	
	var resourcepack_select = $("#resourcepack select");
	var alpha_checkbox = $("#resourcepack #alphaenabled");
	var template_select = $("#template select");
	
	resourcepack_select.prop('selectedIndex',0);
	template_select.prop('selectedIndex',0);
	
	resourcepack_select.on('change', function() {
		resourcepack = resourcepack_select.val();
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
		change_event( editor.getValue() );
	});
	
	$("#statetoggle").on('click', function() {
		var audio = new Audio('sounds/click.ogg');
		audio.play();
		current_state = !current_state;
		change_event( editor.getValue() );
	});
	
	new ResizeSensor($('#editor'), function() {
		editor.resize();
	});
	
	change_event( editor.getValue() );

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

function create_part( i_pos_1, i_pos_2, i_pos_3, i_size_1, i_size_2, i_size_3, texture, tint, state, mat_o )
{
	var size_1 = ( i_size_1 - i_pos_1 );
	var size_2 = ( i_size_2 - i_pos_2 );
	var size_3 = ( i_size_3 - i_pos_3 );
	
	var geometry = new THREE.BoxGeometry(size_1, size_2, size_3 );
	
	var texture_path = ( texture ? 'img/resourcepacks/' + resourcepack + '/blocks/' + texture + '.png' : 'img/grid.png' );
	
	var object_materials = [
		new THREE.MeshPhongMaterial( { map: THREE.ImageUtils.loadTexture(texture_path), transparent: resourcepack_alpha, color: tint } ),
		new THREE.MeshPhongMaterial( { map: THREE.ImageUtils.loadTexture(texture_path), transparent: resourcepack_alpha, color: tint } ),
		new THREE.MeshPhongMaterial( { map: THREE.ImageUtils.loadTexture(texture_path), transparent: resourcepack_alpha, color: tint } ),
		new THREE.MeshPhongMaterial( { map: THREE.ImageUtils.loadTexture(texture_path), transparent: resourcepack_alpha, color: tint } ),
		new THREE.MeshPhongMaterial( { map: THREE.ImageUtils.loadTexture(texture_path), transparent: resourcepack_alpha, color: tint } ),
		new THREE.MeshPhongMaterial( { map: THREE.ImageUtils.loadTexture(texture_path), transparent: resourcepack_alpha, color: tint } )
	]
	object_meshFaceMaterial = new THREE.MeshFaceMaterial( object_materials );
	
	var mesh = new THREE.Mesh( geometry, ( mat_o ? mat_o : object_meshFaceMaterial  ) );
	mesh.position.set( 
		( -8 + ( size_1 / 2 ) ) + i_pos_1, 
		( -8 + ( size_2 / 2 ) ) + i_pos_2, 
		( -( -8 + ( size_3 / 2 ) ) ) - i_pos_3
	);
	
	return mesh;
}

function parse_luaserialize( luastring )
{
	var output_items = {
		'elements'  : [],
		'state_block' : false
	};
	
	var lines = luastring.split('\n');
	
	for(var i = 0;i < lines.length;i++){
		
		var output_item = {
			'coords' : null,
			'texture': 'quartz_block_side',
			'tint'   : 0xffffff,
			'state'  : null,
			'line'   : ( i + 1 )
		};
		
		var coords_exp  = /\{\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+).*\"/g;
		var texture_exp = /texture\s*\=\s*\"(.*)\"/g;
		var tint_exp    = /tint\s*\=\s*(0x......)/g;
		var state_exp   = /state\s*\=\s*(true|false)/g;
		
		coords_exp_match = coords_exp.exec( lines[i] );
		texture_exp_match = texture_exp.exec( lines[i] );
		tint_exp_match = tint_exp.exec( lines[i] );
		state_exp_match = state_exp.exec( lines[i] );

		if( coords_exp_match )
		{
			output_item.coords = [ 
				parseInt( coords_exp_match[ 1 ] ),
				parseInt( coords_exp_match[ 2 ] ),
				parseInt( coords_exp_match[ 3 ] ),
				parseInt( coords_exp_match[ 4 ] ),
				parseInt( coords_exp_match[ 5 ] ),
				parseInt( coords_exp_match[ 6 ] )
			]
		}

		if( texture_exp_match )
			output_item.texture = texture_exp_match[ 1 ];
		
		if( tint_exp_match )
			output_item.tint = parseInt(tint_exp_match[ 1 ], 16);
		
		if( state_exp_match )
		{
			output_item.state = ( state_exp_match[ 1 ] == "true" );
			output_items.state_block = true;
		}
		
		if( coords_exp_match )
			output_items.elements.push( output_item );
	}

	return output_items;
}

function change_cursor_event( line_contents_block_array ){
	
	var line_block = line_contents_block_array.elements[ 0 ];
	if( line_block )
	{
	
		$.each(scene_objects, function(index, value) {
			var block = value[ 0 ];
			var block_data = value[ 1 ];

			if( block_data.coords[ 0 ] == line_block.coords[ 0 ]
				&& block_data.coords[ 1 ] == line_block.coords[ 1 ]
				&& block_data.coords[ 2 ] == line_block.coords[ 2 ]
				&& block_data.coords[ 3 ] == line_block.coords[ 3 ]
				&& block_data.coords[ 4 ] == line_block.coords[ 4 ]
				&& block_data.coords[ 5 ] == line_block.coords[ 5 ] )
			{
				
				if( sel_block )
				{
					scene.remove( sel_block );
					sel_block = null;
				}
				
				sel_block = create_part( 
					block_data.coords[ 0 ], 
					block_data.coords[ 1 ], 
					block_data.coords[ 2 ], 
					block_data.coords[ 3 ], 
					block_data.coords[ 4 ], 
					block_data.coords[ 5 ],
					null,
					null,
					true,
					sel_block_mat
				);
				
				scene.add( sel_block );
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
	
	var block = parse_luaserialize( content );
	
	if( block.state_block )
		$("#statetoggle").attr("disabled", false);
	else
		$("#statetoggle").attr("disabled", true);
		
	$.each(scene_objects, function(index, value) {
		scene.remove( value[ 0 ] );
	});
	
	$.each(block.elements, function(index, value) {

		var clamped_values = [
			clamp( value.coords[ 0 ], 0, 16 ), 
			clamp( value.coords[ 1 ], 0, 16 ), 
			clamp( value.coords[ 2 ], 0, 16 ), 
			clamp( value.coords[ 3 ], 0, 16 ), 
			clamp( value.coords[ 4 ], 0, 16 ), 
			clamp( value.coords[ 5 ], 0, 16 ) 
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
		
		editor.gotoLine(intersects_object.config.line, 0, true);	
		highlightLine( intersects_object.config.line - 1);	
		
		highlightedLineTimeout = setTimeout(function(){
			unhighlightLine();
		}, 1000);
	} else {
		editor.gotoLine(0, 0, true);	
	}
	
}

function highlightLine(lineNumber) {
	  unhighlightLine();
	  var Range = ace.require("ace/range").Range
	  highlightedLine = editor.session.addMarker(new Range(lineNumber, 0, lineNumber, 144), "lineHighlight", "fullLine");
}

function unhighlightLine(){
	editor.getSession().removeMarker( highlightedLine );
	highlightedLine = null;
}

function init() {
	
	scene_objects = [];
	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera( 42, window.innerWidth / window.innerHeight, 1, 1000);
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

	window.addEventListener( 'resize', onWindowResize, false );
}

function animate() {

	requestAnimationFrame(animate);
	renderer.render(scene, camera);
}

function onWindowResize(){

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize( window.innerWidth, window.innerHeight );
	
}