import xml.etree.ElementTree as ET
import glob
import os
import shutil

def get_xmp_metadata(file_path):
    """Extract rating and label from XMP file."""
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            root = ET.fromstring(file.read())
        
        namespaces = {'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'}
        description = root.find('.//rdf:Description', namespaces)
        
        if description is not None:
            rating = description.get('{http://ns.adobe.com/xap/1.0/}Rating')
            label = description.get('{http://ns.adobe.com/xap/1.0/}Label')
            return int(rating) if rating else None, label
        return None, None
    except:
        return None, None

def remove_rating_and_label_from_xmp(file_path):
    """Remove rating and label attributes from XMP file."""
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            content = file.read()
        
        root = ET.fromstring(content)
        
        # Find the RDF Description element
        namespaces = {'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'}
        description = root.find('.//rdf:Description', namespaces)
        
        if description is not None:
            # Remove rating and label attributes
            rating_attr = '{http://ns.adobe.com/xap/1.0/}Rating'
            label_attr = '{http://ns.adobe.com/xap/1.0/}Label'
            
            removed_something = False
            if rating_attr in description.attrib:
                del description.attrib[rating_attr]
                removed_something = True
            
            if label_attr in description.attrib:
                del description.attrib[label_attr]
                removed_something = True
            
            if removed_something:
                # Write the modified XML back to file
                tree = ET.ElementTree(root)
                ET.indent(tree, space="  ", level=0)  # Pretty format
                tree.write(file_path, encoding='utf-8', xml_declaration=True)
                print(f"   🗑️  Removed rating/label from {os.path.basename(file_path)}")
            
        return True
    except Exception as e:
        print(f"   ❌ Error removing metadata from {file_path}: {e}")
        return False

def get_suffix_for_metadata(rating, label):
    """Get the suffix based on rating and label."""
    
    # Check label first - "Select" label gets "r" suffix
    if label and label.lower() == "select":
        return "r"
    
    # Otherwise use rating-based suffix
    rating_suffixes = {
        1: "pose1",
        2: "pose2", 
        3: "pose3",
        4: "f",
        5: "l"
    }
    return rating_suffixes.get(rating)

def rename_and_move_files(player_name):
    """Rename files based on XMP rating/label and move to renamed-player folder."""
    
    # Create the renamed-player folder
    output_folder = "renamed-player"
    if not os.path.exists(output_folder):
        os.makedirs(output_folder)
        print(f"📁 Created folder: {output_folder}")
    else:
        print(f"📁 Using existing folder: {output_folder}")
    
    # Find all XMP files
    xmp_files = glob.glob("*.xmp")
    
    if not xmp_files:
        print("No XMP files found in current directory.")
        return
    
    print(f"\nFound {len(xmp_files)} XMP files. Processing...")
    print("-" * 50)
    
    for xmp_file in xmp_files:
        # Get rating and label from XMP
        rating, label = get_xmp_metadata(xmp_file)
        
        # Get suffix based on rating/label
        suffix = get_suffix_for_metadata(rating, label)
        
        if suffix is None:
            print(f"⚠️  {xmp_file}: No valid rating/label found - skipping")
            continue
        
        # Get base filename without extension
        base_name = os.path.splitext(xmp_file)[0]
        
        # Find all files with the same base name
        related_files = glob.glob(f"{base_name}.*")
        
        # Show what we found
        rating_text = f"{rating}⭐" if rating else "No rating"
        label_text = f"'{label}'" if label else "No label"
        print(f"📁 {base_name}: {rating_text}, {label_text} → {suffix}")
        
        # Copy and rename all related files to the output folder
        copied_xmp = None
        for file_path in related_files:
            file_extension = os.path.splitext(file_path)[1]
            new_name = f"{player_name}_{suffix}{file_extension}"
            new_path = os.path.join(output_folder, new_name)
            
            try:
                shutil.copy2(file_path, new_path)
                print(f"   ✅ {file_path} → {new_name}")
                
                # Keep track of the copied XMP file
                if file_extension.lower() == '.xmp':
                    copied_xmp = new_path
                    
            except Exception as e:
                print(f"   ❌ Error copying {file_path}: {e}")
        
        # Remove rating and label from the copied XMP file
        if copied_xmp:
            remove_rating_and_label_from_xmp(copied_xmp)

if __name__ == "__main__":
    # Get player name from user
    player_name = input("Enter player name (e.g., 100t_verhulst): ").strip()
    
    if not player_name:
        print("Player name cannot be empty!")
        exit()
    
    print(f"\nProcessing files for player: {player_name}")
    print("Mapping rules:")
    print("1⭐ → pose1  |  2⭐ → pose2  |  3⭐ → pose3")
    print("4⭐ → f      |  5⭐ → l")
    print("Label 'Select' → r")
    print("\n📂 Files will be copied to 'renamed-player' folder")
    print("⚠️  Note: Ratings and labels will be removed from copied XMP files")
    print()
    
    # Confirm before proceeding
    confirm = input("Proceed with processing? (y/n): ").strip().lower()
    if confirm == 'y':
        rename_and_move_files(player_name)
        print(f"\nDone! Check the 'renamed-player' folder for your files.")
    else:
        print("Cancelled.")
